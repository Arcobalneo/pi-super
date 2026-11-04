import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseSuperArgs } from "./task.ts";
import { notify } from "./tools.ts";
import type { SuperRuntime } from "./runtime.ts";
import { truncate } from "./text.ts";

const HELP = [
	"/super            status",
	"/super plan       toggle read-only planning",
	"/super loop       arm or disarm the Router loop (arming resets the fuse)",
	"/super run [id]   run open tickets; an id overrides the hop limit once",
	"/super answer <id> <choice>",
	"/super stop <id>  withdraw the mandate",
	"/super why [id]   show the fact log",
].join("\n");

export function registerCommands(
	pi: ExtensionAPI,
	runtime: SuperRuntime,
	paint: (ctx: ExtensionContext) => void,
): void {
	pi.registerCommand("super", {
		description: "Pi-super status, plan mode, loop, dispatch, and answers",
		getArgumentCompletions(prefix: string): AutocompleteItem[] | null {
			const words = ["status", "plan", "loop", "run", "answer", "stop", "why", "help", ...runtime.state.tickets.map((ticket) => ticket.id)];
			const items = words
				.filter((word) => word.startsWith(prefix))
				.map((word) => ({ value: word, label: word }));
			return items.length > 0 ? items : null;
		},
		handler: async (args, ctx) => {
			const parsed = parseSuperArgs(args);
			if (parsed.cmd === "error") return ctx.ui.notify(parsed.message ?? "Bad arguments", "warning");
			if (parsed.cmd === "help" || parsed.cmd === "status") {
				paint(ctx);
				ctx.ui.notify(parsed.cmd === "help" ? HELP : runtime.statusText(), "info");
				return;
			}
			if (parsed.cmd === "plan") {
				const toggled = runtime.togglePlan(pi.getActiveTools());
				pi.setActiveTools(runtime.toolsForMode());
				paint(ctx);
				ctx.ui.notify(toggled.enabled ? "Plan mode on. Writes are disabled." : "Plan mode off.", "info");
				return;
			}
			if (parsed.cmd === "loop") {
				const armed = runtime.toggleLoop();
				pi.setActiveTools(runtime.toolsForMode());
				paint(ctx);
				ctx.ui.notify(armed ? "Router loop on. The fuse was reset." : "Router loop off. This session can edit again.", "info");
				return;
			}
			if (parsed.cmd === "why") {
				ctx.ui.notify(truncate(runtime.why(parsed.ticketId), 2000), "info");
				return;
			}
			if (parsed.cmd === "stop" && parsed.ticketId) {
				const result = runtime.stop(parsed.ticketId);
				paint(ctx);
				ctx.ui.notify(result.message, result.ok ? "info" : "warning");
				return;
			}
			if (parsed.cmd === "answer" && parsed.ticketId && parsed.choice) {
				const result = runtime.answer(parsed.ticketId, parsed.choice);
				paint(ctx);
				if (!result.ok) {
					ctx.ui.notify(result.message, "warning");
					return;
				}
				if (result.stopped || !runtime.state.loopArmed || runtime.state.planMode) {
					ctx.ui.notify(result.message, "info");
					if (!result.stopped && result.resume && !runtime.state.loopArmed) send(pi, ctx, result.resume);
					return;
				}
				const report = await runtime.drain(sessionRequest(ctx));
				paint(ctx);
				notify(ctx, report.notices);
				if (report.needsModel && report.speech) send(pi, ctx, report.speech);
				else ctx.ui.notify(result.message, "info");
				return;
			}
			if (parsed.cmd === "run") {
				const report = await runtime.dispatch({
					...sessionRequest(ctx),
					selector: parsed.ticketId ? "explicit" : "auto",
					ids: parsed.ticketId ? [parsed.ticketId] : undefined,
					ignoreHopLimit: Boolean(parsed.ticketId),
				});
				paint(ctx);
				notify(ctx, report.notices);
				ctx.ui.notify(report.text || "Nothing to dispatch.", report.isError ? "error" : "info");
			}
		},
	});
}

function sessionRequest(ctx: ExtensionCommandContext) {
	return {
		cwd: ctx.cwd,
		model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
		thinkingLevel: ctx.thinkingLevel,
		signal: ctx.signal,
		projectTrusted: ctx.isProjectTrusted(),
		hasUI: ctx.hasUI,
		agentScope: "trusted" as const,
		selector: "auto" as const,
		confirmProject: (message: string) => ctx.ui.confirm("Run project-local agents?", message),
	};
}

function send(pi: ExtensionAPI, ctx: ExtensionCommandContext, text: string): void {
	if (ctx.isIdle()) pi.sendUserMessage(text);
	else pi.sendUserMessage(text, { deliverAs: "followUp" });
}
