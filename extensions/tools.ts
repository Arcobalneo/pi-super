import type { Usage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { SuperRuntime, UserNotice } from "./runtime.ts";
import type { AgentScope, DecisionKind, ReportKind, Strength, UsageStats } from "./types.ts";

interface SuperDetails {
	summary: string;
}

const SCOPES = ["trusted", "bundled", "user", "project", "all"] as const;
const STRENGTHS = ["explicit", "inferred"] as const;
const DECISIONS = ["accept", "stop", "ignore"] as const;
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
			"Record a pi-super decision. accept creates a ticket. stop and ignore record the decision and do not create work. Inferred accepts are dropped when rules acceptInferred is false.",
		promptSnippet: "Accept, stop, or ignore a unit of work as a pi-super ticket",
		promptGuidelines: [
			"Use super_eval before super_dispatch when the user asked for multi-step work.",
			"Use super_eval with decision accept and strength explicit for work the user just requested.",
			"Use super_eval with decision ignore when the request is not actionable.",
		],
		executionMode: "sequential",
		parameters: Type.Object({
			title: Type.String({ description: "Short ticket title" }),
			scope: Type.String({ description: "What the ticket may do. This is the mandate, not untrusted data." }),
			strength: StringEnum(STRENGTHS, { description: "explicit when the user asked; inferred when you are guessing", default: "explicit" }),
			decision: StringEnum(DECISIONS, { description: "accept, stop, or ignore" }),
			reason: Type.String({ description: "Why this decision was made" }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			runtime.reloadRules(ctx.cwd);
			const result = runtime.evalDecision({
				title: params.title,
				scope: params.scope,
				reason: params.reason,
				strength: params.strength as Strength,
				decision: params.decision as DecisionKind,
			});
			paint(ctx);
			return textResult(result.text);
		},
		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("super_eval ")) + theme.fg("accent", `${args.decision} ${args.title}`),
				0,
				0,
			);
		},
		renderResult(result) {
			return new Text(textOf(result.content), 0, 0);
		},
	});

	pi.registerTool({
		name: "super_dispatch",
		label: "Super dispatch",
		description:
			"Run open pi-super tickets in subprocess agents (worker by default). No ids runs every auto-runnable ticket. ticketId runs one ticket. tasks runs those tickets. chain runs scout/planner/worker style steps for one ticketId; only the last step's pi-super fence is applied. {previous} is replaced with the prior step's text.",
		promptSnippet: "Dispatch pi-super tickets to isolated subagents",
		promptGuidelines: [
			"Use super_dispatch with no arguments to run tickets that are ready for an agent.",
			"Use super_dispatch chain with ticketId for scout, then planner, then worker. Put {previous} in later step tasks.",
			"Do not call super_dispatch while plan mode is on or while a ticket needs a person.",
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
			"Record a report for a ticket the orchestrator handled itself. ready ends the ticket. An ask blocks the ticket until /super answer. failed and blocked wait for a person. dropped ends the ticket quietly.",
		promptSnippet: "Record a pi-super report without a subagent",
		promptGuidelines: [
			"Use super_report when you finished a ticket yourself instead of calling super_dispatch.",
			"Use super_report ask when a person must choose. Then stop.",
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
			return textResult(text);
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
