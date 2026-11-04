import type { ReportKind } from "./types.ts";
import { MAX_EVENTS } from "./types.ts";
import { clampText, firstLine, slug } from "./text.ts";

export interface ReceiptAsk {
	title: string;
	text: string;
	options: string[];
	key: string;
	recommend?: number;
	about?: string;
}

export interface ReceiptNotice {
	title: string;
	text: string;
}

export interface ReceiptLater {
	key: string;
	about: string;
}

export interface ReceiptEvent {
	id: string;
	type: string;
	summary: string;
}

export interface Receipt {
	report?: ReportKind;
	summary?: string;
	ask?: ReceiptAsk;
	notice?: ReceiptNotice;
	later?: ReceiptLater;
	events: ReceiptEvent[];
	checks: string[];
	changed: string[];
}

export type ReceiptParse =
	| { status: "absent" }
	| { status: "invalid"; error: string }
	| { status: "ok"; receipt: Receipt };

export interface Interpreted {
	report: ReportKind;
	summary: string;
	ask?: ReceiptAsk;
	notice?: ReceiptNotice;
	later?: ReceiptLater;
	events: ReceiptEvent[];
	checks?: string[];
	changed?: string[];
	receiptError?: string;
	/** True when no receipt block was found at all. */
	receiptMissing?: boolean;
}

const FENCE = /```pi-super[^\n]*\n([\s\S]*?)```/g;
/** Models sometimes label the block json. Accept it only when it looks like a receipt. */
const JSON_FENCE = /```(?:json|jsonc)?[ \t]*\n(\{[\s\S]*?\})\s*```/g;
const SUMMARY_LIMIT = 1200;
const REPORTS = new Set<ReportKind>(["progress", "waiting", "ready", "blocked", "failed", "dropped"]);

function receiptBlock(text: string): string | undefined {
	const tagged = [...text.matchAll(FENCE)].at(-1)?.[1];
	if (tagged !== undefined) return tagged;
	const loose = [...text.matchAll(JSON_FENCE)].map((match) => match[1]!).filter((raw) => /"report"\s*:/.test(raw));
	if (loose.length > 0) return loose.at(-1);
	const tail = text.trimEnd();
	if (tail.endsWith("}")) {
		const start = tail.lastIndexOf('{"report"');
		if (start >= 0) return tail.slice(start);
	}
	return undefined;
}

export function parseReceipt(text: string): ReceiptParse {
	const raw = receiptBlock(text);
	if (raw === undefined) return { status: "absent" };
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return { status: "invalid", error: "pi-super block is not valid JSON" };
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { status: "invalid", error: "pi-super block must be a JSON object" };
	}
	const receipt = normalizeReceipt(value as Record<string, unknown>);
	if (!receipt) return { status: "invalid", error: "pi-super block has no usable fields" };
	return { status: "ok", receipt };
}

export function stripReceiptFence(text: string): string {
	const block = receiptBlock(text);
	let out = text.replace(FENCE, "").replace(JSON_FENCE, (match, raw: string) => (/"report"\s*:/.test(raw) ? "" : match));
	if (block && out.includes(block)) out = out.replace(block, "");
	return out.trim();
}

/** The prose a person can read: the last paragraph, whole, never a cut first line. */
export function proseSummary(text: string): string {
	const paragraphs = stripReceiptFence(text)
		.split(/\n\s*\n/)
		.map((part) => part.trim())
		.filter(Boolean);
	return clampText(paragraphs.at(-1) ?? "", SUMMARY_LIMIT);
}

/**
 * A missing or unreadable receipt does not redo the work.
 * `failed` keeps a notice and drops ask, later, and events.
 * An ask always stops the ticket on a person, so the report becomes `blocked`.
 */
export function interpretOutput(text: string, exitCode: number, stderr: string): Interpreted {
	const parsed = parseReceipt(text);
	const prose = proseSummary(text);
	if (parsed.status === "absent") {
		if (exitCode === 0) return { report: "ready", summary: prose, events: [], receiptMissing: true };
		return { report: "failed", summary: firstLine(stderr.trim() || prose), events: [] };
	}
	if (parsed.status === "invalid") {
		return {
			report: exitCode === 0 ? "ready" : "failed",
			summary: prose,
			events: [],
			receiptError: parsed.error,
		};
	}
	const receipt = parsed.receipt;
	let report: ReportKind = receipt.report ?? (receipt.ask ? "blocked" : exitCode === 0 ? "ready" : "failed");
	if (!REPORTS.has(report)) report = exitCode === 0 ? "ready" : "failed";
	let ask = receipt.ask;
	let later = receipt.later;
	let events = receipt.events;
	if (report === "failed" || report === "dropped") {
		ask = undefined;
		later = undefined;
		events = [];
	} else if (ask) {
		report = "blocked";
	}
	return {
		report,
		summary: clampText(receipt.summary?.trim() || prose, SUMMARY_LIMIT),
		ask,
		notice: receipt.notice,
		later,
		events,
		checks: receipt.checks,
		changed: receipt.changed,
	};
}

function normalizeReceipt(record: Record<string, unknown>): Receipt | undefined {
	const aliased = aliasReport(record);
	const report = typeof aliased.report === "string" && REPORTS.has(aliased.report as ReportKind)
		? (aliased.report as ReportKind)
		: undefined;
	record = aliased;
	const summary = typeof record.summary === "string" ? record.summary : undefined;
	const ask = normalizeAsk(record.ask);
	const notice = normalizeNotice(record.notice);
	const later = normalizeLater(record.later);
	const events = normalizeEvents(record.events);
	const checks = normalizeStrings(record.checks, 8, 500, (item) =>
		item && typeof item === "object" && typeof (item as { run?: unknown }).run === "string" ? (item as { run: string }).run : item,
	);
	const changed = normalizeStrings(record.changed, 50, 300);
	if (record.ask !== undefined && record.ask !== null && !ask) return undefined;
	if (record.notice !== undefined && record.notice !== null && !notice) return undefined;
	if (record.later !== undefined && record.later !== null && !later) return undefined;
	if (record.report !== undefined && !report) return undefined;
	if (!report && !summary && !ask && !notice && !later && events.length === 0) return undefined;
	return { report, summary, ask, notice, later, events, checks, changed };
}

function normalizeStrings(value: unknown, max: number, len: number, map: (item: unknown) => unknown = (item) => item): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.map(map)
		.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
		.slice(0, max)
		.map((item) => clampText(item.trim(), len));
}

/** `ask` and `later` are lifecycle names workers may write. The ledger stores the report kind. */
function aliasReport(record: Record<string, unknown>): Record<string, unknown> {
	if (record.report === "ask") {
		const summary = typeof record.summary === "string" && record.summary.trim() ? record.summary : "Need a decision";
		const ask = record.ask ?? { title: clampText(summary, 120), text: summary, options: ["Continue", "Stop"] };
		return { ...record, report: "blocked", ask };
	}
	if (record.report === "later") {
		const summary = typeof record.summary === "string" && record.summary.trim() ? record.summary : "Follow up later";
		const later = record.later ?? { key: "follow-up", about: summary };
		return { ...record, report: "waiting", later };
	}
	return record;
}

function normalizeAsk(value: unknown): ReceiptAsk | undefined {
	if (value === undefined || value === null) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	if (typeof record.title !== "string" || typeof record.text !== "string") return undefined;
	const title = clampText(record.title, 120);
	const text = clampText(record.text, 2000);
	if (!title || !text) return undefined;
	let options = ["Continue", "Stop"];
	if (record.options !== undefined) {
		if (!Array.isArray(record.options) || record.options.length < 1 || record.options.length > 6) return undefined;
		if (!record.options.every((option) => typeof option === "string" && option.trim())) return undefined;
		options = record.options.map((option) => clampText(String(option), 80));
	}
	const key = typeof record.key === "string" && record.key.trim() ? slug(record.key) : slug(title);
	const recommend =
		typeof record.recommend === "number" && Number.isInteger(record.recommend) && record.recommend >= 0 && record.recommend < options.length
			? record.recommend
			: undefined;
	const about = typeof record.about === "string" && record.about.trim() ? clampText(record.about, 1000) : undefined;
	return { title, text, options, key, ...(recommend !== undefined ? { recommend } : {}), ...(about ? { about } : {}) };
}

function normalizeNotice(value: unknown): ReceiptNotice | undefined {
	if (value === undefined || value === null) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	if (typeof record.title !== "string" || typeof record.text !== "string") return undefined;
	const title = clampText(record.title, 120);
	const text = clampText(record.text, 2000);
	if (!title || !text) return undefined;
	return { title, text };
}

function normalizeLater(value: unknown): ReceiptLater | undefined {
	if (value === undefined || value === null) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	if (typeof record.key !== "string" || typeof record.about !== "string") return undefined;
	const key = slug(record.key);
	const about = clampText(record.about, 500);
	if (!about) return undefined;
	return { key, about };
}

function normalizeEvents(value: unknown): ReceiptEvent[] {
	if (!Array.isArray(value)) return [];
	const events: ReceiptEvent[] = [];
	for (const item of value) {
		if (events.length >= MAX_EVENTS) break;
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const record = item as Record<string, unknown>;
		if (typeof record.id !== "string" || typeof record.summary !== "string") continue;
		const id = clampText(record.id, 120);
		const summary = clampText(record.summary, 2000);
		if (!id || !summary) continue;
		const type = typeof record.type === "string" && record.type.trim() ? clampText(record.type, 80) : "event";
		events.push({ id, type, summary });
	}
	return events;
}
