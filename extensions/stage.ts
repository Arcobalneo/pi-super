import type { Stage, SuperRules, SuperState, Ticket } from "./types.ts";

/**
 * First matching row wins.
 * admit → dispatch → running, then ready / ask / later / failed.
 * A completed ticket stays visible as `ready`. Stop and drop are `ended`.
 */
export function ticketStage(ticket: Ticket): Stage {
	if (ticket.status === "ended") return ticket.outcome === "completed" ? "ready" : "ended";
	if (ticket.attention) return "ask";
	if (ticket.assignment?.status === "running") return "running";
	const kind = ticket.assignment?.reportKind;
	if (kind === "blocked" || kind === "failed") return "failed";
	if (kind === "waiting") return "later";
	if (ticket.later.length > 0 && kind !== "progress") return "later";
	if (!ticket.assignment) return "admit";
	return "dispatch";
}

export function isAutoRunnable(ticket: Ticket, hopLimit: number): boolean {
	if (ticket.status !== "open" || ticket.hops >= hopLimit) return false;
	if (ticket.assignment?.status === "running") return false;
	const stage = ticketStage(ticket);
	return stage === "admit" || stage === "dispatch";
}

export function isManualRunnable(ticket: Ticket, hopLimit: number, ignoreHopLimit = false): boolean {
	if (ticket.status !== "open" || ticket.attention) return false;
	if (ticket.assignment?.status === "running") return false;
	if (!ignoreHopLimit && ticket.hops >= hopLimit) return false;
	const stage = ticketStage(ticket);
	return stage === "admit" || stage === "dispatch" || stage === "failed" || stage === "later";
}

export function personTickets(state: SuperState): Ticket[] {
	return state.tickets.filter((ticket) => {
		const stage = ticketStage(ticket);
		return stage === "ask" || stage === "failed";
	});
}

/** Open work that can no longer run itself. The widget shows it so the person can run or stop it. */
export function hopLimited(ticket: Ticket, hopLimit: number): boolean {
	if (ticket.status !== "open" || ticket.attention || ticket.hops < hopLimit) return false;
	const stage = ticketStage(ticket);
	return stage === "admit" || stage === "dispatch" || stage === "later";
}

export function selectTickets(
	state: SuperState,
	rules: SuperRules,
	request: { mode: "auto" | "explicit"; ids?: string[]; ignoreHopLimit?: boolean },
): { tickets: Ticket[]; error?: string } {
	if (request.mode === "auto") {
		return {
			tickets: state.tickets.filter((ticket) => isAutoRunnable(ticket, rules.hopLimit) && dependenciesDone(state, ticket)),
		};
	}
	const ids = request.ids ?? [];
	if (ids.length === 0) return { tickets: [], error: "Name a ticket id." };
	const tickets: Ticket[] = [];
	for (const id of ids) {
		const ticket = state.tickets.find((item) => item.id === id);
		if (!ticket) return { tickets: [], error: `Unknown ticket ${id}.` };
		if (!isManualRunnable(ticket, rules.hopLimit, request.ignoreHopLimit)) {
			const stage = ticketStage(ticket);
			if (ticket.attention) return { tickets: [], error: `${id} is waiting for /super answer.` };
			if (ticket.hops >= rules.hopLimit && !request.ignoreHopLimit) {
				return { tickets: [], error: `${id} is at the hop limit (${rules.hopLimit}). /super run overrides it.` };
			}
			return { tickets: [], error: `${id} cannot run from stage ${stage}.` };
		}
		tickets.push(ticket);
	}
	return { tickets };
}

export function statusLine(state: SuperState, rules: SuperRules): string | undefined {
	const open = state.tickets.filter((ticket) => ticket.status === "open");
	const needs = state.tickets.filter((ticket) => personTickets(state).includes(ticket) || hopLimited(ticket, rules.hopLimit));
	if (!state.planMode && !state.loopArmed && open.length === 0) return undefined;
	const parts = ["super"];
	if (state.planMode) parts.push("plan");
	if (state.loopArmed) parts.push("router");
	if (open.length > 0) parts.push(`${open.length} open`);
	if (needs.length > 0) parts.push(`${needs.length} needs you`);
	else if (state.loopArmed && open.length === 0) parts.push("idle");
	if (state.loopArmed) parts.push(`fuse ${state.loopHops}/${rules.hopLimit}`);
	return parts.join(" · ");
}

export function widgetLines(state: SuperState, rules: SuperRules, rulesError?: string): string[] {
	const lines: string[] = [];
	if (rulesError) lines.push(`rules: ${rulesError}`);
	for (const ticket of state.tickets.filter((item) => hopLimited(item, rules.hopLimit))) {
		lines.push(`${ticket.id} hop limit (${ticket.hops}/${rules.hopLimit}): ${ticket.assignment?.summary ?? ticket.title}`);
		lines.push(`  /super run ${ticket.id}    /super stop ${ticket.id}`);
	}
	const asks = personTickets(state).filter((ticket) => ticket.attention);
	const first = asks[0];
	if (first?.attention) {
		const options = first.attention.options.map((option, index) => `${index + 1}. ${option}`).join("  ");
		lines.push(`${first.id} needs you: ${first.attention.title}`);
		lines.push(`  ${first.attention.text}`);
		lines.push(`  ${options}`);
		lines.push(`  /super answer ${first.id} <n>`);
		if (asks.length > 1) lines.push(`${asks.length - 1} more question(s) waiting`);
	}
	for (const ticket of personTickets(state)) {
		if (ticket.attention) continue;
		lines.push(`${ticket.id} failed: ${ticket.assignment?.summary ?? "failed"}`);
		lines.push(`  /super run ${ticket.id}    /super stop ${ticket.id}`);
	}
	return lines;
}

export function formatStatus(state: SuperState, rules: SuperRules, rulesError?: string): string {
	const lines = [statusLine(state, rules) ?? "super idle"];
	if (rulesError) lines.push(`rules error: ${rulesError}`);
	lines.push(`policy ${rules.hopLimit} hops, parallel ${rules.parallel}, tell ${rules.tell}, inferred ${rules.acceptInferred ? "on" : "off"}`);
	if (state.tickets.length === 0) lines.push("No tickets.");
	for (const ticket of state.tickets) {
		const spent = ticket.spent ? `  ${ticket.spent.runs} runs ${ticket.spent.tokens} tok $${ticket.spent.cost.toFixed(4)}` : "";
		lines.push(`${ticket.id}  ${ticketStage(ticket)}  hops ${ticket.hops}/${rules.hopLimit}${spent}  ${ticket.title}`);
		// A ticket that waits shows why, so the person need not open its history (dsh-session-superagent docs/kb/status-text-shows-exceptions.md).
		const kind = ticket.assignment?.reportKind;
		if (ticket.status === "open" && (ticket.attention || kind === "blocked" || kind === "failed")) {
			const reason = ticket.attention ? `asks: ${ticket.attention.title}` : `${kind}: ${ticket.assignment?.summary ?? ""}`;
			lines.push(`    ${reason.length > 160 ? `${reason.slice(0, 157)}...` : reason}`);
		}
	}
	const total = state.tickets.reduce((sum, ticket) => ({ tokens: sum.tokens + (ticket.spent?.tokens ?? 0), cost: sum.cost + (ticket.spent?.cost ?? 0) }), { tokens: 0, cost: 0 });
	if (total.tokens > 0) lines.push(`spent ${total.tokens} tokens, $${total.cost.toFixed(4)}`);
	for (const ticket of state.tickets) {
		for (const later of ticket.later) lines.push(`${ticket.id} later ${later.key}: ${later.about}`);
	}
	return lines.join("\n");
}

export function explain(state: SuperState, ticketId?: string): string {
	const facts = ticketId ? state.facts.filter((fact) => mentions(fact, ticketId)) : state.facts.slice(-30);
	if (facts.length === 0) return ticketId ? `No history for ${ticketId}.` : "No pi-super history.";
	return facts.map(formatFact).join("\n");
}

function mentions(fact: SuperState["facts"][number], ticketId: string): boolean {
	switch (fact.type) {
		case "ticket.created":
			return fact.ticket.id === ticketId || fact.ticket.parentId === ticketId;
		case "assignment.started":
		case "assignment.ended":
		case "report.recorded":
		case "attention.opened":
		case "attention.answered":
		case "ticket.ended":
		case "later.recorded":
			return fact.ticketId === ticketId;
		case "notice.recorded":
		case "decision.recorded":
			return fact.ticketId === ticketId;
		default:
			return false;
	}
}

function formatFact(fact: SuperState["facts"][number]): string {
	switch (fact.type) {
		case "ticket.created":
			return `created ${fact.ticket.id} (${fact.ticket.strength}) ${fact.ticket.title}`;
		case "assignment.started":
			return `${fact.ticketId} started ${fact.agent} hop ${fact.hops}`;
		case "assignment.ended":
			return `${fact.ticketId} assignment ended`;
		case "report.recorded":
			return `${fact.ticketId} report ${fact.kind}: ${fact.summary}`;
		case "attention.opened":
			return `${fact.ticketId} asked: ${fact.attention.title}`;
		case "attention.answered":
			return `${fact.ticketId} answer: ${fact.choice}`;
		case "ticket.ended":
			return `${fact.ticketId} ended ${fact.outcome}`;
		case "notice.recorded":
			return `notice${fact.ticketId ? ` ${fact.ticketId}` : ""}: ${fact.title} — ${fact.text}`;
		case "later.recorded":
			return `${fact.ticketId} later ${fact.key}: ${fact.about}`;
		case "decision.recorded":
			return `decision ${fact.decision}: ${fact.title} — ${fact.reason}`;
		case "mode.plan":
			return fact.enabled ? "plan mode on" : "plan mode off";
		case "mode.loop":
			return fact.armed ? "loop armed" : "loop off";
		case "loop.continued":
			return "loop continued";
		case "event.seen":
			return `event ${fact.id}`;
		case "bash.allowed":
			return `bash allowed once: ${fact.command}`;
		default:
			return "unknown fact";
	}
}

/** A ticket with `after` runs only once every ticket it waits for ended completed. */
export function dependenciesDone(state: SuperState, ticket: Ticket): boolean {
	return (ticket.after ?? []).every((id) => state.tickets.find((item) => item.id === id)?.outcome === "completed");
}

/** Dependencies that ended without completing. The waiting ticket cannot run. */
export function brokenDependencies(state: SuperState, ticket: Ticket): Ticket[] {
	return (ticket.after ?? [])
		.map((id) => state.tickets.find((item) => item.id === id))
		.filter((dep): dep is Ticket =>
			Boolean(
				dep &&
					((dep.status === "ended" && dep.outcome !== "completed") ||
						(dep.status === "open" && (dep.assignment?.reportKind === "failed" || dep.assignment?.reportKind === "blocked"))),
			),
		);
}
