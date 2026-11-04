import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SuperRuntime, type Host } from "../extensions/runtime.ts";
import type { SubagentResult } from "../extensions/types.ts";

function result(text: string, exitCode = 0): SubagentResult {
	return {
		agent: "worker",
		exitCode,
		text,
		stderr: "",
		usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.01, turns: 1 },
		aborted: false,
	};
}

function setup(script: (task: string) => SubagentResult) {
	const root = mkdtempSync(join(tmpdir(), "pi-super-runtime-"));
	const agents = join(root, "agents");
	const rulesPath = join(root, "rules.json");
	mkdirSync(agents, { recursive: true });
	writeFileSync(join(agents, "worker.md"), "---\nname: worker\ndescription: Test worker\n---\nWork.\n");
	const files = new Map<string, string>();
	const entries: unknown[] = [];
	const host: Host = {
		appendEntry(_type, data) {
			entries.push({ type: "custom", customType: "pi-super", data });
		},
		getSessionName() {
			return undefined;
		},
		setSessionName() {},
	};
	const runtime = new SuperRuntime(host, {
		bundledAgentsDir: agents,
		userAgentsDir: join(root, "empty-user"),
		userRulesPath: rulesPath,
		configDirName: ".pi",
		readFile: (path) => files.get(path),
		findProjectFile: () => undefined,
		findProjectDir: () => undefined,
		runAgent: async (request) => script(request.task),
	});
	runtime.beginSession([], root);
	return { runtime, entries, files, rulesPath, agents };
}

function writeRole(dir: string, name: string): void {
	writeFileSync(join(dir, `${name}.md`), `---\nname: ${name}\ndescription: ${name} role\n---\nYou are a ${name}.\n`);
}

describe("runtime", () => {
	it("accepts a ticket, runs a worker, and ends on ready", async () => {
		const { runtime } = setup(() => result("Parser added.\n```pi-super\n{\"report\":\"ready\",\"summary\":\"Parser added.\"}\n```"));
		expect(runtime.evalDecision({ title: "Parser", scope: "Add a parser", strength: "explicit", decision: "accept", reason: "user asked" }).text).toMatch(/Accepted t1/);
		const report = await runtime.dispatch({
			cwd: "/tmp",
			agentScope: "trusted",
			projectTrusted: true,
			selector: "auto",
			hasUI: false,
		});
		expect(report.dispatched).toBe(1);
		expect(report.text).toContain("t1 ready: Parser added.");
		expect(runtime.state.tickets[0]?.status).toBe("ended");
		expect(runtime.state.tickets[0]?.hops).toBe(1);
	});

	it("opens an attention and does not auto-run it again", async () => {
		const { runtime } = setup(() =>
			result('```pi-super\n{"report":"blocked","summary":"Need a choice","ask":{"title":"Ship?","text":"How?","options":["PR","Patch"],"key":"ship"}}\n```'),
		);
		runtime.armLoop();
		runtime.evalDecision({ title: "Ship", scope: "Ship it", strength: "explicit", decision: "accept", reason: "user asked" });
		const drained = await runtime.drain({ cwd: "/tmp", agentScope: "trusted", projectTrusted: true, selector: "auto", hasUI: true });
		expect(drained.needsModel).toBe(true);
		expect(runtime.state.tickets[0]?.attention?.title).toBe("Ship?");
		const again = await runtime.drain({ cwd: "/tmp", agentScope: "trusted", projectTrusted: true, selector: "auto", hasUI: true });
		expect(again.dispatched).toBe(0);
	});

	it("stops at the hop limit and drops events from a failed receipt", async () => {
		let calls = 0;
		const { runtime, files, rulesPath } = setup(() => {
			calls += 1;
			return result('```pi-super\n{"report":"progress","summary":"still going","events":[{"id":"e1","summary":"next"}]}\n```');
		});
		files.set(rulesPath, '{"hopLimit":1}');
		runtime.evalDecision({ title: "Loop", scope: "Keep going", strength: "explicit", decision: "accept", reason: "user asked" });
		await runtime.dispatch({ cwd: "/tmp", agentScope: "trusted", projectTrusted: true, selector: "auto" });
		expect(calls).toBe(1);
		expect(runtime.state.tickets.some((ticket) => ticket.parentId === "t1")).toBe(false);
		expect(runtime.state.tickets[0]?.notices.some((notice) => notice.title === "Hop limit")).toBe(true);
		const second = await runtime.dispatch({ cwd: "/tmp", agentScope: "trusted", projectTrusted: true, selector: "auto" });
		expect(second.dispatched).toBe(0);
		expect(calls).toBe(1);
	});

	it("does not create inferred tickets when the rules forbid them", async () => {
		const { runtime, files, rulesPath } = setup(() =>
			result('```pi-super\n{"report":"ready","summary":"done","events":[{"id":"e1","summary":"do more"}]}\n```'),
		);
		files.set(rulesPath, '{"acceptInferred":false}');
		runtime.evalDecision({ title: "Once", scope: "Once", strength: "explicit", decision: "accept", reason: "user asked" });
		await runtime.dispatch({ cwd: "/tmp", agentScope: "trusted", projectTrusted: true, selector: "explicit", ids: ["t1"] });
		expect(runtime.state.tickets).toHaveLength(1);
		expect(runtime.state.seenEvents).toContain("e1");
	});

	it("refuses dispatch in plan mode and stays quiet when the loop is off", async () => {
		const { runtime } = setup(() => result("done"));
		runtime.togglePlan(["read", "bash", "edit", "write"]);
		const blocked = await runtime.dispatch({ cwd: "/tmp", agentScope: "trusted", projectTrusted: true, selector: "auto" });
		expect(blocked.isError).toBe(true);
		runtime.evalDecision({ title: "Plan", scope: "Read", strength: "explicit", decision: "accept", reason: "user asked" });
		const drained = await runtime.drain({ cwd: "/tmp", agentScope: "trusted", projectTrusted: true, selector: "auto" });
		expect(drained.dispatched).toBe(0);
	});

	it("replays the ledger from session entries", async () => {
		const first = setup(() => result('```pi-super\n{"report":"ready","summary":"done"}\n```'));
		first.runtime.evalDecision({ title: "Replay", scope: "Work", strength: "explicit", decision: "accept", reason: "user asked" });
		await first.runtime.dispatch({ cwd: "/tmp", agentScope: "trusted", projectTrusted: true, selector: "auto" });
		const second = setup(() => result("nope"));
		second.runtime.beginSession(first.entries, "/tmp");
		expect(second.runtime.state.tickets[0]?.status).toBe("ended");
		expect(second.runtime.why("t1")).toContain("ready");
	});

	it("keeps the last good rules when the file becomes invalid", () => {
		const { runtime, files, rulesPath } = setup(() => result("done"));
		files.set(rulesPath, '{"hopLimit":2}');
		runtime.reloadRules("/tmp");
		expect(runtime.rules.hopLimit).toBe(2);
		files.set(rulesPath, "{");
		runtime.reloadRules("/tmp");
		expect(runtime.rules.hopLimit).toBe(2);
		expect(runtime.rulesError).toMatch(/JSON/);
	});

	it("runs the lane once per round and stops when a role asks", async () => {
		const seen: string[] = [];
		const { runtime, agents } = setup((task) => {
			seen.push(task);
			if (task.includes("Map the files")) {
				return result("src/greet.ts\n```pi-super\n{\"report\":\"ask\",\"summary\":\"Which name?\",\"ask\":{\"title\":\"Name?\",\"text\":\"Which greeting name?\",\"options\":[\"Ada\",\"Lin\"]}}\n```");
			}
			return result("should not run");
		});
		for (const name of ["scout", "planner", "worker", "reviewer"]) writeRole(agents, name);
		runtime.evalDecision({ title: "Greet", scope: "Update greet", strength: "explicit", decision: "accept", reason: "user asked", lane: "code" });
		const report = await runtime.dispatch({ cwd: "/tmp", agentScope: "trusted", projectTrusted: true, selector: "auto" });
		expect(report.dispatched).toBe(1);
		expect(seen).toHaveLength(1);
		expect(runtime.state.tickets[0]?.hops).toBe(1);
		expect(runtime.state.tickets[0]?.attention?.title).toBe("Name?");
		expect(report.needsModel).toBe(true);
	});

	it("counts a full code pipeline as one hop and delivers only the review", async () => {
		let calls = 0;
		const { runtime, agents } = setup((task) => {
			calls += 1;
			if (task.includes("Review the result")) {
				return result("Looks good.\n```pi-super\n{\"report\":\"ready\",\"summary\":\"Greeting updated.\"}\n```");
			}
			return result(`step ${calls} notes`);
		});
		for (const name of ["scout", "planner", "worker", "reviewer"]) writeRole(agents, name);
		runtime.armLoop();
		runtime.evalDecision({ title: "Greet", scope: "Update greet", strength: "explicit", decision: "accept", reason: "user asked" });
		const drained = await runtime.drain({ cwd: "/tmp", agentScope: "trusted", projectTrusted: true, selector: "auto", hasUI: true });
		expect(calls).toBe(4);
		expect(runtime.state.tickets[0]?.hops).toBe(1);
		expect(runtime.state.tickets[0]?.status).toBe("ended");
		expect(drained.needsModel).toBe(true);
		expect(drained.speech).toContain("Greeting updated.");
		expect(drained.speech).toContain("Do not call tools");
		const again = await runtime.drain({ cwd: "/tmp", agentScope: "trusted", projectTrusted: true, selector: "auto", hasUI: true });
		expect(again.dispatched).toBe(0);
		expect(again.needsModel).toBe(false);
	});

	it("reports the hop limit instead of narrating progress", async () => {
		const { runtime, files, rulesPath } = setup(() => result('```pi-super\n{"report":"progress","summary":"still going"}\n```'));
		files.set(rulesPath, '{"hopLimit":1}');
		runtime.armLoop();
		runtime.evalDecision({ title: "Loop", scope: "Keep going", strength: "explicit", decision: "accept", reason: "user asked" });
		const drained = await runtime.drain({ cwd: "/tmp", agentScope: "trusted", projectTrusted: true, selector: "auto", hasUI: true });
		expect(drained.needsModel).toBe(true);
		expect(drained.speech).toContain("hop limit");
		expect(drained.speech).not.toContain("still going");
	});

	it("resumes a ticket after the person answers", async () => {
		let calls = 0;
		const { runtime } = setup(() => {
			calls += 1;
			if (calls === 1) {
				return result('```pi-super\n{"report":"ask","summary":"Need a choice","ask":{"title":"Ship?","text":"How?","options":["PR","Patch"],"key":"ship"}}\n```');
			}
			return result('```pi-super\n{"report":"ready","summary":"Patched."}\n```');
		});
		runtime.armLoop();
		runtime.evalDecision({ title: "Ship", scope: "Ship it", strength: "explicit", decision: "accept", reason: "user asked" });
		await runtime.drain({ cwd: "/tmp", agentScope: "trusted", projectTrusted: true, selector: "auto", hasUI: true });
		expect(runtime.answer(undefined, "2").message).toContain("Patch");
		const resumed = await runtime.drain({ cwd: "/tmp", agentScope: "trusted", projectTrusted: true, selector: "auto", hasUI: true });
		expect(calls).toBe(2);
		expect(resumed.speech).toContain("Patched.");
		expect(runtime.state.tickets[0]?.status).toBe("ended");
	});

	it("blocks an ask-first assignment until the person answers", async () => {
		let calls = 0;
		const { runtime } = setup(() => {
			calls += 1;
			return result('```pi-super\n{"report":"ready","summary":"removed"}\n```');
		});
		runtime.evalDecision({
			title: "Clean",
			scope: "Run rm -rf dist",
			strength: "explicit",
			decision: "accept",
			reason: "user asked",
		});
		const blocked = await runtime.dispatch({ cwd: "/tmp", agentScope: "trusted", projectTrusted: true, selector: "auto" });
		expect(calls).toBe(0);
		expect(blocked.text).toContain("needs you");
		const answer = runtime.answer("t1", "1");
		expect(answer.ok).toBe(true);
		await runtime.dispatch({ cwd: "/tmp", agentScope: "trusted", projectTrusted: true, selector: "explicit", ids: ["t1"] });
		expect(calls).toBe(1);
	});
});
