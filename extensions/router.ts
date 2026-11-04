/** Router role: the main session admits and speaks. Workers stay under the hood. */

import type { Lane } from "./types.ts";

export const ROUTER_CONTRACT = [
	"You are the Router for this session. The person talks only to you.",
	"You admit work and report results. You do not implement, edit files, or run shell commands. Workers do that, and they have no channel to the person.",
	"When the person asks for work, call super_eval once: decision accept, strength explicit, scope is the mandate, lane is code (a change), review (read-only review), or answer (a question about the repo). Confirm in one sentence what you will do, then stop. The loop runs the workers.",
	"When a message is not a request, call super_eval with ignore, or answer a status question in one sentence.",
	"Ask at most one concrete question, via super_report or by relaying a worker question, and only when work cannot continue without that decision. Then stop.",
	"If the person answers an open question, call super_answer and stop. Do not admit a second ticket for the same answer.",
	"A message that starts with \"From the worker receipt:\" is already the summary. Do not restate it. Do not add a file, check, name, or command that the receipt does not contain.",
	"Stay under 100 words. Report a failure as a failure. Do not claim work is done unless the receipt says ready.",
].join("\n");

export const PLAN_CONTRACT = [
	"Plan mode is read-only. Call super_eval to record tickets. Do not dispatch, edit, or implement.",
	"The person decides when to leave plan mode.",
].join("\n");

export const ADMIT_NUDGE = [
	"[pi-super delivery]",
	"No decision was recorded for the person's latest message.",
	"If it answers an open question, call super_answer and stop.",
	"If it is new work, call super_eval with decision accept and strength explicit, confirm in one sentence, and stop.",
	"If it is not a request, call super_eval with ignore, or reply in one sentence.",
	"Do not implement it yourself.",
].join("\n");

const HEAVY = new Set(["edit", "write", "bash", "super_dispatch"]);

/** Tools the Router may see. Coding tools and manual dispatch stay off. */
export function routerTools(active: readonly string[]): string[] {
	const kept = active.filter((name) => !HEAVY.has(name));
	return [...new Set([...kept, "read", "grep", "find", "ls", "super_eval", "super_answer", "super_status", "super_report"])];
}

export type PipelinePhase = "initial" | "repair";

/** A reviewer progress report sends the ticket back to the worker, then the reviewer. */
export function nextPhase(ticket: { assignment?: { agent?: string; reportKind?: string } }): PipelinePhase {
	if (ticket.assignment?.agent === "reviewer" && ticket.assignment.reportKind === "progress") return "repair";
	return "initial";
}

export function pipelineFor(lane: Lane, names: readonly string[], phase: PipelinePhase = "initial"): { agent: string; task: string }[] {
	const have = new Set(names);
	const wanted =
		phase === "repair"
			? ["worker", "reviewer"]
			: lane === "review"
				? ["reviewer"]
				: lane === "answer"
					? ["scout"]
					: ["scout", "planner", "worker", "reviewer"];
	let roles = wanted.filter((role) => have.has(role));
	if (roles.length === 0) roles = have.has("worker") ? ["worker"] : ["worker"];
	return roles.map((agent, index) => ({
		agent,
		task: phase === "repair" ? repairTask(agent) : roleTask(agent, index === roles.length - 1),
	}));
}

function roleTask(agent: string, final: boolean): string {
	switch (agent) {
		case "scout":
			return final
				? "Answer the mandate from the repository. Do not edit files. End with one pi-super receipt."
				: "Map the files that matter. Do not edit files. Do not emit a receipt unless you must ask the person one question or you cannot continue.\n\n{previous}";
		case "planner":
			return "Write a concrete plan a worker can execute. Do not edit files. Do not emit a receipt unless one decision is required before any edit.\n\n{previous}";
		case "worker":
			return final
				? "Implement the mandate. End with one pi-super receipt. Use ready only when the mandate is done.\n\n{previous}"
				: "Implement the mandate. A reviewer runs after you. Do not emit a receipt unless you must ask one question or you failed. Summarize the change.\n\n{previous}";
		case "reviewer":
			return [
				"Check the files against every acceptance criterion in the mandate.",
				"A criterion is a required behavior or an exact check, such as greet(\"Ada\") === \"Hello, Ada!\".",
				"Use ready only when each criterion is present. Quote the criterion and the file line that satisfies it.",
				"If a test or result uses a different literal than the mandate, do not say ready. Use progress and name both literals so the worker can fix it.",
				"Do not claim a command passed unless you ran it. Use ask only when a person must choose. Do not edit files.",
				"",
				"{previous}",
			].join("\n");
		default:
			return "Do the mandate, then end with one pi-super receipt.\n\n{previous}";
	}
}

function repairTask(agent: string): string {
	if (agent === "worker") {
		return [
			"The reviewer rejected the result. Fix every mismatch named in the previous report.",
			"The summary must list the checks that are actually in the files, not the checks the mandate asked for unless they are now the same.",
			"",
			"{previous}",
		].join("\n");
	}
	return [
		"Review the files again against every acceptance criterion in the mandate.",
		"Use ready only if each required literal is now present. Use progress if any mismatch remains, and name it.",
		"Do not edit files.",
		"",
		"{previous}",
	].join("\n");
}

export interface GroundedResult {
	id: string;
	kind: string;
	evidence: string;
}

export interface GroundedQuestion {
	id: string;
	title: string;
	evidence: string;
	options: string[];
}

/**
 * The text the person sees. It is assembled from receipt fields only.
 * A fact that is not in `evidence` cannot appear, because nothing else is copied in.
 */
/** Quoted acceptance checks in a mandate, such as `"$1.99"`. */
export function acceptanceLiterals(scope: string): string[] {
	const found: string[] = [];
	for (const match of scope.matchAll(/"([^"\n]{1,120})"|'([^'\n]{1,120})'/g)) {
		const value = (match[1] ?? match[2] ?? "").trim();
		// Option words such as "keep" are not file checks. A literal with a
		// digit or symbol, such as "$1.99", is.
		if (value && /[^A-Za-z\s]/.test(value) && !found.includes(value)) found.push(value);
	}
	return found;
}

/** Literals the mandate quotes that do not appear in the project text. */
export function missingAcceptanceLiterals(scope: string, corpus: string): string[] {
	return acceptanceLiterals(scope).filter((literal) => !corpus.includes(literal));
}

export function groundedSpeech(input: {
	results: GroundedResult[];
	question?: GroundedQuestion;
	extraQuestions: number;
	capped: boolean;
	hopNote?: string;
}): string | undefined {
	const results = input.results.filter((result) => result.evidence.trim());
	if (results.length === 0 && !input.question && !input.capped && !input.hopNote) return undefined;
	const lines = ["From the worker receipt:"];
	for (const result of results) {
		lines.push(`${result.id} ${result.kind}.`);
		lines.push(result.evidence.trim());
	}
	if (input.question) {
		lines.push(`${input.question.id} needs you: ${input.question.title}`);
		lines.push(input.question.evidence.trim());
		lines.push(input.question.options.map((option, index) => `${index + 1}. ${option}`).join("\n"));
		if (input.extraQuestions > 0) lines.push(`${input.extraQuestions} other question(s) stay queued.`);
	}
	if (input.hopNote) lines.push(input.hopNote);
	if (input.capped) lines.push("The loop stopped before every ticket finished.");
	return lines.join("\n");
}
