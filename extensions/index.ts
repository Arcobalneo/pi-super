/**
 * Pi Superagent.
 *
 * The main session is the Router. It admits work and speaks to the person.
 * Workers are isolated `pi` subprocesses with extensions disabled so the
 * loop cannot recurse. The person never talks to a worker.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Key } from "@earendil-works/pi-tui";
import {
	CONFIG_DIR_NAME,
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	isToolCallEventType,
} from "@earendil-works/pi-coding-agent";
import { bundledAgentsDir } from "./agents.ts";
import { asksFirst, isReadOnlyCommand } from "./gate.ts";
import { findUp } from "./paths.ts";
import { ADMIT_NUDGE, PLAN_CONTRACT, ROUTER_CONTRACT } from "./router.ts";
import { SuperRuntime } from "./runtime.ts";
import { runSubagent } from "./runner.ts";
import { personTickets, statusLine, widgetLines } from "./stage.ts";
import { CONTEXT_TYPE, RESULT_TYPE, STATUS_KEY } from "./types.ts";
import { registerCommands } from "./commands.ts";
import { notify, registerTools } from "./tools.ts";

export default function piSuper(pi: ExtensionAPI): void {
	const runtime = new SuperRuntime(pi, {
		bundledAgentsDir: bundledAgentsDir(),
		userAgentsDir: join(getAgentDir(), "agents"),
		userRulesPath: join(getAgentDir(), "super", "rules.json"),
		configDirName: CONFIG_DIR_NAME,
		readFile: readOptional,
		findProjectFile: (cwd, parts) => findUp(cwd, parts, "file"),
		findProjectDir: (cwd, parts) => findUp(cwd, parts, "dir"),
		runAgent: (request) => runSubagent(request),
	});

	const paint = (ctx: ExtensionContext): void => {
		if (!ctx.hasUI) return;
		const line = statusLine(runtime.state, runtime.rules);
		const needs = personTickets(runtime.state).length > 0;
		ctx.ui.setStatus(STATUS_KEY, line ? ctx.ui.theme.fg(needs ? "warning" : "accent", line) : undefined);
		const lines = widgetLines(runtime.state, runtime.rules, runtime.rulesError);
		ctx.ui.setWidget(STATUS_KEY, lines.length > 0 ? lines : undefined);
	};

	registerTools(pi, runtime, paint);
	registerCommands(pi, runtime, paint);

	pi.registerFlag("super", {
		description: "Arm the pi-super loop for this process",
		type: "boolean",
		default: false,
	});
	pi.registerFlag("super-plan", {
		description: "Start pi-super in read-only plan mode",
		type: "boolean",
		default: false,
	});
	pi.registerFlag("super-off", {
		description: "Do not take the Router role; leave this session as a normal coding agent",
		type: "boolean",
		default: false,
	});
	pi.registerShortcut(Key.ctrlAlt("s"), {
		description: "Show pi-super status",
		handler: async (ctx) => {
			paint(ctx);
			ctx.ui.notify(runtime.statusText(), "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		runtime.beginSession(ctx.sessionManager.getBranch(), ctx.cwd);
		runtime.rememberTools(pi.getActiveTools());
		if (pi.getFlag("super-off") === true) runtime.disarmLoop();
		else if (pi.getFlag("super") === true || !runtime.state.loopTouched) runtime.armLoop();
		if (pi.getFlag("super-plan") === true || runtime.state.planMode) {
			pi.setActiveTools(runtime.armPlan(runtime.toolsForMode()));
		} else {
			pi.setActiveTools(runtime.toolsForMode());
		}
		paint(ctx);
		if (runtime.rulesError && ctx.hasUI && runtime.rules.tell !== "never") ctx.ui.notify(runtime.rulesError, "warning");
	});

	pi.on("session_shutdown", async () => {
		runtime.endSession();
	});

	pi.on("agent_start", async () => {
		runtime.acceptedThisRun = 0;
	});

	pi.on("context", async (event) => ({
		messages: event.messages.filter((message) => (message as { customType?: string }).customType !== CONTEXT_TYPE),
	}));

	pi.on("before_agent_start", async (event) => {
		if (event.messageType === "user") runtime.noteUserPrompt(event.prompt);
		if (runtime.state.loopArmed || runtime.state.planMode) {
			const contract = runtime.state.planMode ? PLAN_CONTRACT : ROUTER_CONTRACT;
			const prior = event.systemPromptOptions.appendSystemPrompt;
			event.systemPromptOptions.appendSystemPrompt = prior ? `${prior}\n\n${contract}` : contract;
		}
		if (event.messageType !== "user") return;
		const open = runtime.state.tickets.some((ticket) => ticket.status === "open");
		if (!runtime.state.planMode && !runtime.state.loopArmed && !open) return;
		return {
			message: {
				customType: CONTEXT_TYPE,
				content: runtime.contextBlurb(),
				display: false,
			},
		};
	});

	pi.on("tool_call", async (event, ctx) => {
		if (runtime.state.loopArmed && !runtime.state.planMode) {
			if (event.toolName === "edit" || event.toolName === "write" || event.toolName === "bash" || event.toolName === "super_dispatch") {
				return {
					block: true,
					reason: "The Router does not implement. Call super_eval to admit the work. Workers run it.",
				};
			}
		}
		if (runtime.state.planMode && (event.toolName === "edit" || event.toolName === "write")) {
			return { block: true, reason: "Plan mode blocks writes. Use /super plan to leave it." };
		}
		if (!isToolCallEventType("bash", event)) return;
		const command = event.input.command;
		if (runtime.state.planMode && !isReadOnlyCommand(command)) {
			return { block: true, reason: `Plan mode blocks this command.\n${command}` };
		}
		const matched = asksFirst(command, runtime.rules);
		if (!matched || runtime.state.bashAllowed.includes(command)) return;
		if (ctx.hasUI) {
			const ok = await ctx.ui.confirm("Ask first", `Rule "${matched}" matches:\n${command}\n\nAllow it once?`);
			if (ok) {
				runtime.allowBash(command);
				paint(ctx);
				return;
			}
		}
		return { block: true, reason: `Blocked by ask-first rule "${matched}".` };
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (!runtime.state.planMode || !ctx.hasUI || runtime.acceptedThisRun <= 0) return;
		runtime.acceptedThisRun = 0;
		const choice = await ctx.ui.select("Plan recorded", ["Dispatch the tickets", "Stay in plan mode", "Refine the plan"]);
		if (choice?.startsWith("Dispatch")) {
			runtime.togglePlan(pi.getActiveTools());
			pi.setActiveTools(runtime.toolsForMode());
			paint(ctx);
			pi.sendUserMessage(
				runtime.state.loopArmed
					? "Plan accepted. The loop will run the open tickets. Do not implement them. Stop if a ticket needs a person."
					: "Plan accepted. Call super_dispatch for the open tickets. Stop if a ticket needs a person.",
				{ deliverAs: "followUp" },
			);
		} else if (choice === "Refine the plan") {
			pi.sendUserMessage("Refine the plan. Stay in plan mode. Call super_eval if the tickets should change.", {
				deliverAs: "followUp",
			});
		}
	});

	pi.on("agent_before_settle", async (event, ctx) => {
		if (event.outcome !== "completed" || !runtime.state.loopArmed || runtime.state.planMode) return;
		if (runtime.shouldNudge()) {
			runtime.admitNudged = true;
			return {
				continue: true,
				entries: [
					...event.entries,
					{ type: "custom_message", customType: RESULT_TYPE, content: ADMIT_NUDGE, display: false },
				],
			};
		}
		const report = await runtime.drain({
			cwd: ctx.cwd,
			model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
			thinkingLevel: ctx.thinkingLevel,
			signal: ctx.signal,
			projectTrusted: ctx.isProjectTrusted(),
			hasUI: ctx.hasUI,
			agentScope: "trusted",
			selector: "auto",
			confirmProject: (message) => ctx.ui.confirm("Run project-local agents?", message),
		});
		paint(ctx);
		notify(ctx, report.notices);
		if (!report.needsModel || !report.speech) return;
		runtime.spokeThisRun = true;
		return {
			continue: true,
			entries: [
				...event.entries,
				{ type: "custom_message", customType: RESULT_TYPE, content: report.speech, display: false },
			],
		};
	});
}

function readOptional(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}
