/** Router role: the main session admits and speaks. Workers stay under the hood. */

import type { Lane } from "./types.ts";

export const ROUTER_CONTRACT = [
	"You are the Router for this session. The person talks only to you.",
	"You admit work and report results. You do not implement, edit files, or run shell commands. Workers do that, and they have no channel to the person.",
	"When the person asks for work, call super_eval once: decision accept, strength explicit, scope is the mandate, lane is code (a change), review (read-only review), or answer (a question about the repo). Confirm in one sentence what you will do, then stop. The loop runs the workers.",
	"When a message is not a request, call super_eval with ignore, or answer a status question in one sentence.",
	"Ask at most one concrete question, via super_report or by relaying a worker question, and only when work cannot continue without that decision. Then stop.",
	"If the person answers an open question, call super_answer and stop. Do not admit a second ticket for the same answer.",
	"A message that starts with \"[pi-super delivery]\" is a result or the one question to ask. Summarize a result in a few sentences. Ask that question as written, then stop. Do not call tools on a delivery turn.",
	"Stay under 100 words. Report a failure as a failure. Do not claim work is done unless the delivery says ready.",
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

export function pipelineFor(lane: Lane, names: readonly string[]): { agent: string; task: string }[] {
	const have = new Set(names);
	const wanted = lane === "review" ? ["reviewer"] : lane === "answer" ? ["scout"] : ["scout", "planner", "worker", "reviewer"];
	let roles = wanted.filter((role) => have.has(role));
	if (roles.length === 0) roles = have.has("worker") ? ["worker"] : ["worker"];
	return roles.map((agent, index) => ({
		agent,
		task: roleTask(agent, index === roles.length - 1),
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
			return "Review the result against the mandate. Do not edit files. End with one pi-super receipt. Use ready only if the mandate is done. Use ask for one decision. Use failed when the work is wrong.\n\n{previous}";
		default:
			return "Do the mandate, then end with one pi-super receipt.\n\n{previous}";
	}
}

export function deliverySpeech(input: {
	results: string[];
	question?: string;
	extraQuestions: number;
	capped: boolean;
	hopNote?: string;
}): string | undefined {
	if (input.results.length === 0 && !input.question && !input.capped && !input.hopNote) return undefined;
	const lines = [
		"[pi-super delivery]",
		"You are the Router. Speak to the person in under 100 words. Do not call tools. Do not implement anything.",
		"Use only the result lines below. Do not add files, checks, or commands that those lines do not mention.",
	];
	if (input.results.length > 0) {
		lines.push("", "Results:");
		for (const line of input.results) lines.push(`- ${line}`);
	}
	if (input.question) {
		lines.push("", "Ask this one question, then stop.");
		lines.push(input.question);
		if (input.extraQuestions > 0) lines.push(`${input.extraQuestions} other question(s) stay queued. Do not ask them now.`);
	}
	if (input.hopNote) lines.push("", input.hopNote);
	if (input.capped) lines.push("", "The loop stopped before every ticket finished. Say what is still open.");
	return lines.join("\n");
}
