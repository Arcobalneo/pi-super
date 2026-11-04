/** Router role: the main session admits and speaks. Workers stay under the hood. */

import type { Lane } from "./types.ts";

export const ROUTER_CONTRACT = [
	"You are the Router for this session. The person talks only to you. You route; workers do the work and never talk to the person.",
	"You never implement, edit files, or run commands, and you do not plan, break down, or add requirements to a request. Workers receive the person's own words verbatim and derive requirements from them.",
	"For each message pick one super_eval decision: accept (new work), attach (a follow-up that points at an existing ticket: it is delivered to that ticket verbatim and resumes it), stop (the person asks to stop a ticket), or ignore (not a request).",
	"accept: a short title, lane (code changes files in the repo, task produces a non-code deliverable such as a document or research notes, review is a read-only review, answer is a question about the repo), and at most a 30-word routing note with background only. Use after to order tickets the person asked to run in sequence; one ticket per independent piece of work the person named.",
	"If the person left a decision open that blocks the start, or asked you to consult them first, put that one question in super_eval ask with options. The tool returns the question; reply with exactly that text and nothing else.",
	"If the person answers an open question, call super_answer and stop.",
	"A message that starts with \"From the worker receipt:\" is already shown to the person. Do not restate it.",
	"A tool result that starts with NOT ACCEPTED, NOT ATTACHED, NOT RECORDED, or QUESTION NOT SENT means nothing happened. Say so plainly. Never claim a question was sent or work was done unless a tool result says so.",
	"Use super_recall with a ticket id when the person refers to earlier work. Stay under 100 words. After accept or attach, confirm in one sentence and stop.",
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
	return [...new Set([...kept, "read", "grep", "find", "ls", "super_eval", "super_answer", "super_status", "super_report", "super_recall"])];
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

const RECEIPT_RULES =
	"End with one pi-super receipt. ready needs checks (commands the kernel reruns to prove the result) and changed (files you created or changed). Use ask for one decision only the person can make, dropped when nothing needs doing, failed when you cannot finish.";

function roleTask(agent: string, final: boolean): string {
	switch (agent) {
		case "scout":
			return final
				? "Answer the original request from the repository and sources you can read. Do not edit files. End with one pi-super receipt whose summary is the answer."
				: "Map what matters for the original request: files, sources, facts, open decisions. Do not edit files. Emit a receipt only to ask the person one question or to report you cannot continue.\n\n{previous}";
		case "planner":
			return "Write a short plan a worker can execute for the original request, in its own terms. List any decision only the person can make. Do not edit files. Emit a receipt only when such a decision blocks every next step.\n\n{previous}";
		case "worker":
			return final
				? `Produce the deliverable the original request asks for. ${RECEIPT_RULES}\n\n{previous}`
				: "Produce the deliverable the original request asks for. A reviewer checks it after you. Emit a receipt only to ask one question or report failure. End with what you changed and how you checked it.\n\n{previous}";
		case "reviewer":
			return [
				"Review the deliverable against the original request, word by word: every requirement, constraint, example, file location, and limit the person stated, and every decision under Decided.",
				"Run what proves it: the project's tests, the person's examples as real calls, or reads of the produced file. Do not trust the worker's summary. Do not edit files.",
				"ready only when every point holds. Otherwise progress, naming each gap so the worker can fix it.",
				RECEIPT_RULES,
				"",
				"{previous}",
			].join("\n");
		default:
			return `Do the ticket. ${RECEIPT_RULES}\n\n{previous}`;
	}
}

function repairTask(agent: string): string {
	if (agent === "worker") {
		return "The review found gaps against the original request. Fix every gap named in the previous report, then summarize what changed.\n\n{previous}";
	}
	return [
		"Review the deliverable again against the original request, word by word. Rerun the checks.",
		"ready only when every gap is closed.",
		RECEIPT_RULES,
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
	recommend?: number;
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
		lines.push(
			input.question.options
				.map((option, index) => `${index + 1}. ${option}${input.question?.recommend === index ? "（推荐 / recommended）" : ""}`)
				.join("\n"),
		);
		if (input.extraQuestions > 0) lines.push(`${input.extraQuestions} other question(s) stay queued.`);
	}
	if (input.hopNote) lines.push(input.hopNote);
	if (input.capped) lines.push("The loop stopped before every ticket finished.");
	return lines.join("\n");
}
