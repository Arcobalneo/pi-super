import type { Usage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { SuperRuntime, UserNotice } from "./runtime.ts";
import type { AgentScope, DecisionKind, Lane, ReportKind, Strength, UsageStats } from "./types.ts";

interface SuperDetails {
	summary: string;
}

const SCOPES = ["trusted", "bundled", "user", "project", "all"] as const;
const STRENGTHS = ["explicit", "inferred"] as const;
const DECISIONS = ["accept", "attach", "stop", "ignore"] as const;
const LANES = ["code", "task", "review", "answer"] as const;
const REPORTS = ["progress", "waiting", "ready", "blocked", "failed", "dropped"] as const;

export function registerTools(
	pi: ExtensionAPI,
	runtime: SuperRuntime,
	paint: (ctx: ExtensionContext) => void,
): void {
	pi.registerTool({
		name: "super_eval",
		label: "Super eval",
		description:
			"Route the person's latest message. accept creates a ticket; workers receive the person's words verbatim. attach delivers a follow-up to an existing ticket and resumes it. stop withdraws a ticket. ignore records that nothing is needed.",
		promptSnippet: "Route a message: accept, attach, stop, or ignore. Workers do the work",
		promptGuidelines: [
			"Call super_eval once per message from the person. Do not implement it yourself.",
			"Do not rewrite the request into requirements, plans, or acceptance criteria. Workers read the person's own words.",
			"Use attach with ticketId when the message is about an existing ticket (open or ended). Use stop with ticketId when the person asks to stop one.",
			"Split only what the person named as separate pieces of work; use after to order them.",
			"If a decision the person left open blocks the start, or they asked to be consulted first, pass that one question in ask; then reply with exactly the question text the tool returns.",
			"If a result starts with NOT ACCEPTED or NOT ATTACHED, nothing happened; fix the call or tell the person.",
		],
		executionMode: "sequential",
		parameters: Type.Object({
			decision: StringEnum(DECISIONS, { description: "accept, attach, stop, or ignore" }),
			title: Type.String({ description: "Short ticket title" }),
			reason: Type.String({ description: "Why this decision" }),
			strength: StringEnum(STRENGTHS, { description: "explicit when the person asked; inferred when you are guessing", default: "explicit" }),
			lane: Type.Optional(
				StringEnum(LANES, {
					description: 'code changes repository files; task produces another deliverable (document, research, plan); review is read-only review; answer is a question about the repo. Default "code".',
					default: "code",
				}),
			),
			note: Type.Optional(Type.String({ description: "At most 30 words of routing background. Never requirements or plans." })),
			scope: Type.Optional(Type.String({ description: "Deprecated alias of note." })),
			ticketId: Type.Optional(Type.String({ description: "For attach or stop: the ticket the message is about." })),
			after: Type.Optional(Type.Array(Type.String(), { description: "Ticket ids that must complete before this one runs." })),
			ask: Type.Optional(
				Type.Object(
					{
						title: Type.String(),
						text: Type.String({ description: "The one question, in the person's language." }),
						options: Type.Optional(Type.Array(Type.String())),
						recommend: Type.Optional(Type.Integer({ description: "Index of the recommended option." })),
						about: Type.Optional(Type.String({ description: "Context for the worker who resumes after the answer." })),
						key: Type.Optional(Type.String()),
					},
					{ description: "One blocking question at intake. The ticket waits until super_answer." },
				),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			runtime.reloadRules(ctx.cwd);
			const result = runtime.evalDecision({
				title: params.title,
				note: params.note ?? params.scope,
				reason: params.reason,
				strength: (params.strength ?? "explicit") as Strength,
				decision: params.decision as DecisionKind,
				lane: params.lane as Lane | undefined,
				ticketId: params.ticketId,
				after: params.after,
				ask: params.ask,
			});
			paint(ctx);
			return textResult(result.text, result.isError);
		},
		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("super_eval ")) + theme.fg("accent", `${args.decision} ${args.ticketId ?? args.title}`),
				0,
				0,
			);
		},
		renderResult(result) {
			return new Text(textOf(result.content), 0, 0);
		},
	});

	pi.registerTool({
		name: "super_recall",
		label: "Super recall",
		description: "Recall one ticket by id: the person's words, decisions, last report, and related ticket ids to follow. Read-only.",
		promptSnippet: "Recall a pi-super ticket by id (Chain of Recall)",
		promptGuidelines: ["Use super_recall when the person refers to earlier work, then follow related ids if needed."],
		executionMode: "sequential",
		parameters: Type.Object({ id: Type.String() }),
		async execute(_id, params) {
			const text = runtime.recall(params.id);
			return textResult(text, text.startsWith("NOT FOUND"));
		},
		renderCall(args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("super_recall ")) + theme.fg("accent", args.id), 0, 0);
		},
		renderResult(result) {
			return new Text(textOf(result.content), 0, 0);
		},
	});

	pi.registerTool({
		name: "super_answer",
		label: "Super answer",
		description:
			"Record the person's answer to the one open question, then stop. The loop resumes that ticket. Omit ticketId when only one question is open.",
		promptSnippet: "Record the person's answer to the open pi-super question",
		promptGuidelines: [
			"Call super_answer when the person answers the open question. Then stop.",
			"Do not admit a new ticket for that answer.",
		],
		executionMode: "sequential",
		parameters: Type.Object({
			choice: Type.String({ description: "The option number or the option text." }),
			ticketId: Type.Optional(Type.String({ description: "Ticket id. Omit when only one question is open." })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const result = runtime.answer(params.ticketId, params.choice);
			paint(ctx);
			return textResult(result.ok ? `${result.message} Stop. The loop continues if the ticket can run.` : result.message, !result.ok);
		},
		renderCall(args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("super_answer ")) + theme.fg("accent", args.choice), 0, 0);
		},
		renderResult(result) {
			return new Text(textOf(result.content), 0, 0);
		},
	});

	pi.registerTool({
		name: "super_dispatch",
		label: "Super dispatch",
		description:
			"Run open tickets in isolated worker processes. The Router loop does this itself; call it only when the loop is off. No ids runs every auto-runnable ticket through its lane. chain runs explicit steps for one ticketId; {previous} is the prior step's text. A role stops the chain when it asks or fails.",
		promptSnippet: "Run pi-super tickets in isolated workers when the loop is off",
		promptGuidelines: [
			"Do not call super_dispatch while the Router loop is on. The loop runs workers after super_eval.",
			"Do not call super_dispatch in plan mode or while a ticket needs a person.",
		],
		executionMode: "sequential",
		parameters: Type.Object({
			ticketId: Type.Optional(Type.String({ description: "One ticket. Required with chain." })),
			agent: Type.Optional(Type.String({ description: "Agent name. Default worker." })),
			task: Type.Optional(Type.String({ description: "Override the assignment text." })),
			tasks: Type.Optional(
				Type.Array(
					Type.Object({
						ticketId: Type.String(),
						agent: Type.Optional(Type.String()),
						task: Type.Optional(Type.String()),
					}),
					{ description: "Explicit tickets to run together." },
				),
			),
			chain: Type.Optional(
				Type.Array(
					Type.Object({
						agent: Type.String(),
						task: Type.String({ description: "May contain {previous}." }),
					}),
					{ description: "Ordered steps for ticketId." },
				),
			),
			agentScope: Type.Optional(
				StringEnum(SCOPES, {
					description: 'Where to load agents. Default "trusted" (bundled and user). "all" or "project" can run repo-controlled agents.',
					default: "trusted",
				}),
			),
		}),
		async execute(_id, params, signal, onUpdate, ctx) {
			if (params.tasks && (params.chain || params.ticketId)) {
				return textResult("Pass tasks, or ticketId, or ticketId plus chain. Not more than one mode.", true);
			}
			if (params.chain && !params.ticketId) return textResult("chain requires ticketId.", true);
			const ids = params.tasks?.map((task) => task.ticketId) ?? (params.ticketId ? [params.ticketId] : undefined);
			const report = await runtime.dispatch({
				...toolContext(ctx, signal, onUpdate),
				agentScope: (params.agentScope ?? "trusted") as AgentScope,
				selector: ids ? "explicit" : "auto",
				ids,
				agent: params.agent,
				task: params.task,
				tasks: params.tasks,
				chain: params.chain,
			});
			paint(ctx);
			notify(ctx, report.notices);
			return textResult(report.text, report.isError, report.usage);
		},
		renderCall(args, theme) {
			const mode = args.chain ? "chain" : args.tasks ? "parallel" : (args.ticketId ?? "open tickets");
			return new Text(theme.fg("toolTitle", theme.bold("super_dispatch ")) + theme.fg("accent", String(mode)), 0, 0);
		},
		renderResult(result) {
			return new Text(textOf(result.content), 0, 0);
		},
	});

	pi.registerTool({
		name: "super_report",
		label: "Super report",
		description:
			"Record a report without a worker. Use it to ask the person one question. ready ends the ticket. An ask waits for super_answer. failed waits for the person. dropped ends the ticket quietly. Do not use this to implement the ticket.",
		promptSnippet: "Ask the person one question, or record a Router report",
		promptGuidelines: [
			"Use super_report with an ask when one decision is required before work can start. Then stop.",
			"Do not use super_report to claim that you implemented the work.",
		],
		executionMode: "sequential",
		parameters: Type.Object({
			ticketId: Type.String(),
			kind: StringEnum(REPORTS, { description: "progress, waiting, ready, blocked, failed, or dropped" }),
			summary: Type.String(),
			ask: Type.Optional(
				Type.Object({
					title: Type.String(),
					text: Type.String(),
					options: Type.Optional(Type.Array(Type.String())),
					key: Type.Optional(Type.String()),
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const text = runtime.recordReport(params.ticketId, params.kind as ReportKind, params.summary, params.ask
				? {
						title: params.ask.title,
						text: params.ask.text,
						options: params.ask.options ?? ["Continue", "Stop"],
						key: params.ask.key ?? params.ask.title,
					}
				: undefined);
			paint(ctx);
			const failed = text.startsWith("QUESTION NOT SENT") || text.startsWith("NOT RECORDED");
			const shown = params.ask && !failed ? `${text} The question is shown from the receipt. Do not restate it. Stop.` : text;
			return textResult(shown, failed);
		},
		renderCall(args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("super_report ")) + theme.fg("accent", args.ticketId), 0, 0);
		},
		renderResult(result) {
			return new Text(textOf(result.content), 0, 0);
		},
	});

	pi.registerTool({
		name: "super_status",
		label: "Super status",
		description: "Show pi-super tickets, fuse, and rules. Read-only.",
		promptSnippet: "Show the pi-super ledger",
		promptGuidelines: ["Use super_status to see which tickets are open or waiting for a person."],
		executionMode: "sequential",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			paint(ctx);
			return textResult(runtime.statusText());
		},
		renderCall(_args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("super_status")), 0, 0);
		},
		renderResult(result) {
			return new Text(textOf(result.content), 0, 0);
		},
	});
}

function toolContext(
	ctx: ExtensionToolContext,
	signal: AbortSignal | undefined,
	onUpdate: ((partial: { content: { type: "text"; text: string }[]; details: SuperDetails }) => void) | undefined,
) {
	return {
		cwd: ctx.cwd,
		model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
		thinkingLevel: ctx.thinkingLevel,
		signal,
		projectTrusted: ctx.isProjectTrusted(),
		hasUI: ctx.hasUI,
		confirmProject: (message: string) => ctx.ui.confirm("Run project-local agents?", message),
		onProgress: (line: string) => onUpdate?.({ content: [{ type: "text", text: line }], details: { summary: line } }),
	};
}

function textResult(text: string, isError = false, stats?: UsageStats) {
	return {
		content: [{ type: "text" as const, text }],
		details: { summary: text },
		...(isError ? { isError: true } : {}),
		...(stats && stats.turns > 0 ? { usage: toUsage(stats) } : {}),
	};
}

function toUsage(stats: UsageStats): Usage {
	return {
		input: stats.input,
		output: stats.output,
		cacheRead: stats.cacheRead,
		cacheWrite: stats.cacheWrite,
		totalTokens: stats.input + stats.output + stats.cacheRead + stats.cacheWrite,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: stats.cost },
	};
}

function textOf(content: { type: string; text?: string }[]): string {
	return content.map((part) => part.text ?? "").join("\n");
}

export function notify(ctx: ExtensionContext, notices: UserNotice[]): void {
	if (!ctx.hasUI) return;
	for (const notice of notices) ctx.ui.notify(notice.message, notice.level);
}
