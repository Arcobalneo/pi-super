/** Domain types for the pi-super ledger. Facts are the only durable writes. */

export const ENTRY_TYPE = "pi-super";
export const CONTEXT_TYPE = "pi-super-context";
export const RESULT_TYPE = "pi-super-result";
export const STATUS_KEY = "pi-super";
export const DEFAULT_AGENT = "worker";
export const MAX_EVENTS = 4;
export const MAX_DRAIN_STEPS = 32;

export type Strength = "explicit" | "inferred";

export type ReportKind = "progress" | "waiting" | "ready" | "blocked" | "failed" | "dropped";

export type DecisionKind = "accept" | "attach" | "stop" | "ignore";

/** Live ticket lifecycle. `ended` is a stop or a drop, not a successful delivery. */
export type Stage = "admit" | "dispatch" | "running" | "ready" | "ask" | "later" | "failed" | "ended";

export type Lane = "code" | "task" | "review" | "answer";

export type TellMode = "always" | "needed" | "never";

export interface SuperRules {
	hopLimit: number;
	parallel: number;
	tell: TellMode;
	acceptInferred: boolean;
	askFirst: string[];
}

export interface Attention {
	id: string;
	title: string;
	text: string;
	options: string[];
	key: string;
	/** Index into options the asker recommends. */
	recommend?: number;
	/** Note for whoever resumes: background and what each option means in practice. */
	about?: string;
}

/** Verbatim input that reached a ticket: the person's request, a follow-up, or an answer. */
export interface TicketInput {
	kind: "request" | "followup";
	text: string;
}

/** A replayable check a receipt claims it ran. */
export interface ReceiptCheck {
	run: string;
}

export interface Assignment {
	id: string;
	agent: string;
	status: "pending" | "running" | "ended";
	reportKind?: ReportKind;
	summary?: string;
}

export interface TicketData {
	id: string;
	summary: string;
}

export interface Ticket {
	id: string;
	title: string;
	scope: string;
	strength: Strength;
	policyVersion: string;
	askFirst: string[];
	status: "open" | "ended";
	outcome?: string;
	lane: Lane;
	hops: number;
	parentId?: string;
	/** The person's own words. Workers derive requirements from these, not from the Router. */
	inputs: TicketInput[];
	/** Router routing note: background only, never requirements. */
	note?: string;
	/** Tickets that must end completed before this one runs. */
	after: string[];
	assignment?: Assignment;
	attention?: Attention;
	answers: { key: string; choice: string; title?: string; about?: string }[];
	notices: { title: string; text: string }[];
	later: { key: string; about: string }[];
	data: TicketData[];
}

export interface TicketSeed {
	id: string;
	title: string;
	scope: string;
	strength: Strength;
	policyVersion: string;
	askFirst: string[];
	lane?: Lane;
	hops: number;
	parentId?: string;
	data?: TicketData[];
	inputs?: TicketInput[];
	note?: string;
	after?: string[];
}

export interface DecisionRecord {
	decision: DecisionKind;
	title: string;
	reason: string;
	ticketId?: string;
}

export type Fact =
	| { type: "mode.plan"; enabled: boolean; toolsBefore?: string[] }
	| { type: "mode.loop"; armed: boolean; resetFuse?: boolean }
	| { type: "loop.continued" }
	| { type: "ticket.created"; ticket: TicketSeed }
	| { type: "assignment.started"; ticketId: string; assignmentId: string; agent: string; hops: number }
	| { type: "assignment.ended"; ticketId: string; assignmentId: string }
	| { type: "report.recorded"; ticketId: string; kind: ReportKind; summary: string }
	| { type: "attention.opened"; ticketId: string; attention: Attention }
	| { type: "attention.answered"; ticketId: string; choice: string }
	| { type: "input.added"; ticketId: string; input: TicketInput }
	| { type: "ticket.ended"; ticketId: string; outcome: string }
	| { type: "notice.recorded"; ticketId?: string; title: string; text: string }
	| { type: "later.recorded"; ticketId: string; key: string; about: string }
	| { type: "bash.allowed"; command: string }
	| { type: "event.seen"; id: string }
	| { type: "decision.recorded"; decision: DecisionKind; title: string; reason: string; ticketId?: string };

export interface SuperState {
	facts: Fact[];
	tickets: Ticket[];
	seenEvents: string[];
	bashAllowed: string[];
	decisions: DecisionRecord[];
	notices: { title: string; text: string }[];
	planMode: boolean;
	toolsBeforePlan?: string[];
	loopArmed: boolean;
	/** True after a loop fact is replayed, so a fresh session can default the loop on. */
	loopTouched: boolean;
	loopHops: number;
}

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	source: "bundled" | "user" | "project";
	filePath: string;
}

export type AgentScope = "trusted" | "bundled" | "user" | "project" | "all";

export interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	turns: number;
}

export interface SubagentResult {
	agent: string;
	exitCode: number;
	text: string;
	stderr: string;
	usage: UsageStats;
	stopReason?: string;
	errorMessage?: string;
	aborted: boolean;
}
