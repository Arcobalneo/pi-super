import type {
	Attention,
	DecisionKind,
	Fact,
	ReportKind,
	Strength,
	SuperState,
	Ticket,
	TicketSeed,
} from "./types.ts";

const REPORTS = new Set<ReportKind>(["progress", "waiting", "ready", "blocked", "failed", "dropped"]);
const STRENGTHS = new Set<Strength>(["explicit", "inferred"]);
const DECISIONS = new Set<DecisionKind>(["accept", "stop", "ignore"]);

export function emptyState(): SuperState {
	return {
		facts: [],
		tickets: [],
		seenEvents: [],
		bashAllowed: [],
		decisions: [],
		notices: [],
		planMode: false,
		loopArmed: false,
		loopHops: 0,
	};
}

export function reduce(state: SuperState, fact: Fact): SuperState {
	const next = structuredClone(state);
	next.facts.push(fact);
	switch (fact.type) {
		case "mode.plan":
			next.planMode = fact.enabled;
			next.toolsBeforePlan = fact.enabled ? fact.toolsBefore : undefined;
			break;
		case "mode.loop":
			next.loopArmed = fact.armed;
			if (fact.armed && fact.resetFuse) next.loopHops = 0;
			break;
		case "loop.continued":
			next.loopHops += 1;
			break;
		case "ticket.created": {
			if (next.tickets.some((ticket) => ticket.id === fact.ticket.id)) break;
			next.tickets.push(seedTicket(fact.ticket));
			for (const item of fact.ticket.data ?? []) remember(next, item.id);
			break;
		}
		case "assignment.started": {
			const ticket = openTicket(next, fact.ticketId);
			if (!ticket) break;
			ticket.assignment = { id: fact.assignmentId, agent: fact.agent, status: "running" };
			ticket.hops = fact.hops;
			break;
		}
		case "assignment.ended": {
			const ticket = findTicket(next, fact.ticketId);
			if (ticket?.assignment?.id === fact.assignmentId) ticket.assignment.status = "ended";
			break;
		}
		case "report.recorded": {
			const ticket = openTicket(next, fact.ticketId);
			if (!ticket) break;
			ticket.assignment = ticket.assignment ?? {
				id: "unassigned",
				agent: "worker",
				status: "ended",
			};
			ticket.assignment.reportKind = fact.kind;
			ticket.assignment.summary = fact.summary;
			if (fact.kind === "ready") finish(ticket, "completed");
			if (fact.kind === "dropped") finish(ticket, "dropped");
			break;
		}
		case "attention.opened": {
			const ticket = openTicket(next, fact.ticketId);
			if (ticket) ticket.attention = fact.attention;
			break;
		}
		case "attention.answered": {
			const ticket = findTicket(next, fact.ticketId);
			if (!ticket) break;
			const key = ticket.attention?.key ?? "answer";
			ticket.answers.push({ key, choice: fact.choice });
			ticket.attention = undefined;
			break;
		}
		case "ticket.ended": {
			const ticket = findTicket(next, fact.ticketId);
			if (ticket) finish(ticket, fact.outcome);
			break;
		}
		case "notice.recorded": {
			const notice = { title: fact.title, text: fact.text };
			const ticket = fact.ticketId ? findTicket(next, fact.ticketId) : undefined;
			if (ticket) ticket.notices.push(notice);
			else next.notices.push(notice);
			break;
		}
		case "later.recorded": {
			const ticket = openTicket(next, fact.ticketId);
			if (!ticket) break;
			const existing = ticket.later.find((item) => item.key === fact.key);
			if (existing) existing.about = fact.about;
			else ticket.later.push({ key: fact.key, about: fact.about });
			break;
		}
		case "bash.allowed":
			if (!next.bashAllowed.includes(fact.command)) next.bashAllowed.push(fact.command);
			break;
		case "event.seen":
			remember(next, fact.id);
			break;
		case "decision.recorded":
			next.decisions.push({
				decision: fact.decision,
				title: fact.title,
				reason: fact.reason,
				ticketId: fact.ticketId,
			});
			break;
		default:
			break;
	}
	return next;
}

export function project(facts: Fact[]): SuperState {
	return facts.reduce(reduce, emptyState());
}

export function nextId(state: SuperState, prefix: string): string {
	let max = 0;
	const scan = (id: string | undefined) => {
		if (!id?.startsWith(prefix)) return;
		const value = Number(id.slice(prefix.length));
		if (Number.isInteger(value) && value > max) max = value;
	};
	for (const ticket of state.tickets) {
		scan(ticket.id);
		scan(ticket.assignment?.id);
		scan(ticket.attention?.id);
	}
	return `${prefix}${max + 1}`;
}

export function parseFact(value: unknown): Fact | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	switch (record.type) {
		case "mode.plan":
			return typeof record.enabled === "boolean"
				? {
						type: "mode.plan",
						enabled: record.enabled,
						toolsBefore: stringList(record.toolsBefore),
					}
				: undefined;
		case "mode.loop":
			return typeof record.armed === "boolean"
				? { type: "mode.loop", armed: record.armed, resetFuse: record.resetFuse === true }
				: undefined;
		case "loop.continued":
			return { type: "loop.continued" };
		case "ticket.created":
			return parseTicketSeed(record.ticket) ? { type: "ticket.created", ticket: parseTicketSeed(record.ticket)! } : undefined;
		case "assignment.started":
			return isString(record.ticketId) &&
				isString(record.assignmentId) &&
				isString(record.agent) &&
				isInt(record.hops)
				? {
						type: "assignment.started",
						ticketId: record.ticketId,
						assignmentId: record.assignmentId,
						agent: record.agent,
						hops: record.hops,
					}
				: undefined;
		case "assignment.ended":
			return isString(record.ticketId) && isString(record.assignmentId)
				? { type: "assignment.ended", ticketId: record.ticketId, assignmentId: record.assignmentId }
				: undefined;
		case "report.recorded":
			return isString(record.ticketId) && isReport(record.kind) && isString(record.summary)
				? { type: "report.recorded", ticketId: record.ticketId, kind: record.kind, summary: record.summary }
				: undefined;
		case "attention.opened": {
			const attention = parseAttention(record.attention);
			return isString(record.ticketId) && attention
				? { type: "attention.opened", ticketId: record.ticketId, attention }
				: undefined;
		}
		case "attention.answered":
			return isString(record.ticketId) && isString(record.choice)
				? { type: "attention.answered", ticketId: record.ticketId, choice: record.choice }
				: undefined;
		case "ticket.ended":
			return isString(record.ticketId) && isString(record.outcome)
				? { type: "ticket.ended", ticketId: record.ticketId, outcome: record.outcome }
				: undefined;
		case "notice.recorded":
			return isString(record.title) && isString(record.text)
				? {
						type: "notice.recorded",
						ticketId: isString(record.ticketId) ? record.ticketId : undefined,
						title: record.title,
						text: record.text,
					}
				: undefined;
		case "later.recorded":
			return isString(record.ticketId) && isString(record.key) && isString(record.about)
				? { type: "later.recorded", ticketId: record.ticketId, key: record.key, about: record.about }
				: undefined;
		case "bash.allowed":
			return isString(record.command) ? { type: "bash.allowed", command: record.command } : undefined;
		case "event.seen":
			return isString(record.id) ? { type: "event.seen", id: record.id } : undefined;
		case "decision.recorded":
			return isDecision(record.decision) && isString(record.title) && isString(record.reason)
				? {
						type: "decision.recorded",
						decision: record.decision,
						title: record.title,
						reason: record.reason,
						ticketId: isString(record.ticketId) ? record.ticketId : undefined,
					}
				: undefined;
		default:
			return undefined;
	}
}

export function factsFromEntries(entries: unknown[]): Fact[] {
	const facts: Fact[] = [];
	for (const entry of entries) {
		if (!entry || typeof entry !== "object") continue;
		const record = entry as { type?: string; customType?: string; data?: unknown };
		if (record.type !== "custom" || record.customType !== "pi-super") continue;
		const fact = parseFact(record.data);
		if (fact) facts.push(fact);
	}
	return facts;
}

function seedTicket(seed: TicketSeed): Ticket {
	return {
		id: seed.id,
		title: seed.title,
		scope: seed.scope,
		strength: seed.strength,
		policyVersion: seed.policyVersion,
		askFirst: [...seed.askFirst],
		status: "open",
		hops: seed.hops,
		parentId: seed.parentId,
		answers: [],
		notices: [],
		later: [],
		data: [...(seed.data ?? [])],
	};
}

function finish(ticket: Ticket, outcome: string): void {
	ticket.status = "ended";
	ticket.outcome = outcome;
	ticket.attention = undefined;
	if (ticket.assignment && ticket.assignment.status === "running") ticket.assignment.status = "ended";
}

function findTicket(state: SuperState, id: string): Ticket | undefined {
	return state.tickets.find((ticket) => ticket.id === id);
}

function openTicket(state: SuperState, id: string): Ticket | undefined {
	const ticket = findTicket(state, id);
	return ticket?.status === "open" ? ticket : undefined;
}

function remember(state: SuperState, id: string): void {
	if (!state.seenEvents.includes(id)) state.seenEvents.push(id);
}

function parseTicketSeed(value: unknown): TicketSeed | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	if (!isString(record.id) || !isString(record.title) || !isString(record.scope)) return undefined;
	if (!isStrength(record.strength) || !isString(record.policyVersion) || !isInt(record.hops)) return undefined;
	const askFirst = stringList(record.askFirst);
	if (!askFirst) return undefined;
	const data = parseData(record.data);
	return {
		id: record.id,
		title: record.title,
		scope: record.scope,
		strength: record.strength,
		policyVersion: record.policyVersion,
		askFirst,
		hops: record.hops,
		parentId: isString(record.parentId) ? record.parentId : undefined,
		data,
	};
}

function parseAttention(value: unknown): Attention | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	const options = stringList(record.options);
	if (!isString(record.id) || !isString(record.title) || !isString(record.text) || !isString(record.key) || !options) {
		return undefined;
	}
	return { id: record.id, title: record.title, text: record.text, key: record.key, options };
}

function parseData(value: unknown): { id: string; summary: string }[] | undefined {
	if (value === undefined) return [];
	if (!Array.isArray(value)) return undefined;
	const data: { id: string; summary: string }[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object") return undefined;
		const record = item as Record<string, unknown>;
		if (!isString(record.id) || !isString(record.summary)) return undefined;
		data.push({ id: record.id, summary: record.summary });
	}
	return data;
}

function stringList(value: unknown): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return undefined;
	return value as string[];
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}

function isInt(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isReport(value: unknown): value is ReportKind {
	return typeof value === "string" && REPORTS.has(value as ReportKind);
}

function isStrength(value: unknown): value is Strength {
	return typeof value === "string" && STRENGTHS.has(value as Strength);
}

function isDecision(value: unknown): value is DecisionKind {
	return typeof value === "string" && DECISIONS.has(value as DecisionKind);
}
