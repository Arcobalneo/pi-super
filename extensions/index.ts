/**
 * Pi Superagent.
 *
 * The main session is the orchestrator. Tickets live in append-only session
 * entries. Subagents are `pi` subprocesses, same shape as the official
 * subagent example, with extensions disabled so the kernel cannot recurse.
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
import { asksFirst, isReadOnlyCommand, planModeTools } from "./gate.ts";
import { findUp } from "./paths.ts";
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
	pi.registerShortcut(Key.ctrlAlt("s"), {
		description: "Show pi-super status",
		handler: async (ctx) => {
			paint(ctx);
			ctx.ui.notify(runtime.statusText(), "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		runtime.beginSession(ctx.sessionManager.getBranch(), ctx.cwd);
		if (pi.getFlag("super") === true) runtime.armLoop();
		if (pi.getFlag("super-plan") === true) pi.setActiveTools(runtime.armPlan(pi.getActiveTools()));
		else if (runtime.state.planMode) pi.setActiveTools(planModeTools(runtime.state.toolsBeforePlan ?? pi.getActiveTools()));
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
			const toggled = runtime.togglePlan(pi.getActiveTools());
			pi.setActiveTools(toggled.tools);
			paint(ctx);
			pi.sendUserMessage("Plan accepted. Call super_dispatch for the open tickets. Stop if a ticket needs a person.", {
				deliverAs: "followUp",
			});
		} else if (choice === "Refine the plan") {
			pi.sendUserMessage("Refine the plan. Stay in plan mode. Call super_eval if the tickets should change.", {
				deliverAs: "followUp",
			});
		}
	});

	pi.on("agent_before_settle", async (event, ctx) => {
		if (event.outcome !== "completed" || !runtime.state.loopArmed || runtime.state.planMode) return;
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
