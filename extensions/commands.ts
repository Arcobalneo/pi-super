import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseSuperArgs } from "./task.ts";
import { notify } from "./tools.ts";
import type { SuperRuntime } from "./runtime.ts";
import { truncate } from "./text.ts";

const HELP = [
	"/super            status",
	"/super plan       toggle read-only planning",
	"/super loop       arm or disarm the autonomous loop (arming resets the fuse)",
	"/super run [id]   dispatch open tickets; an id overrides the hop limit once",
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
				pi.setActiveTools(toggled.tools);
				paint(ctx);
				ctx.ui.notify(toggled.enabled ? "Plan mode on. Writes are disabled." : "Plan mode off.", "info");
				return;
			}
			if (parsed.cmd === "loop") {
				const armed = runtime.toggleLoop();
				paint(ctx);
				ctx.ui.notify(armed ? "Loop armed. The fuse was reset." : "Loop off.", "info");
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
				ctx.ui.notify(result.message, result.ok ? "info" : "warning");
				if (result.resume) send(pi, ctx, result.resume);
				return;
			}
			if (parsed.cmd === "run") {
				const report = await runtime.dispatch({
					cwd: ctx.cwd,
					model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
					thinkingLevel: ctx.thinkingLevel,
					signal: ctx.signal,
					projectTrusted: ctx.isProjectTrusted(),
					hasUI: ctx.hasUI,
					agentScope: "trusted",
					selector: parsed.ticketId ? "explicit" : "auto",
					ids: parsed.ticketId ? [parsed.ticketId] : undefined,
					ignoreHopLimit: Boolean(parsed.ticketId),
					confirmProject: (message) => ctx.ui.confirm("Run project-local agents?", message),
				});
				paint(ctx);
				notify(ctx, report.notices);
				ctx.ui.notify(report.text || "Nothing to dispatch.", report.isError ? "error" : "info");
			}
		},
	});
}

function send(pi: ExtensionAPI, ctx: ExtensionCommandContext, text: string): void {
	if (ctx.isIdle()) pi.sendUserMessage(text);
	else pi.sendUserMessage(text, { deliverAs: "followUp" });
}
