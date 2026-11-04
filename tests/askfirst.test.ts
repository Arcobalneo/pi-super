import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bareImports, detectConstraints } from "../extensions/constraints.ts";
import { SuperRuntime, type Host } from "../extensions/runtime.ts";
import type { SubagentResult } from "../extensions/types.ts";

function result(text: string): SubagentResult {
	return { agent: "worker", exitCode: 0, text, stderr: "", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1 }, aborted: false };
}

const READY = "Done.\n```pi-super\n{\"report\":\"ready\",\"summary\":\"Done.\"}\n```";

function repo(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-super-ask-"));
	mkdirSync(join(dir, "src"));
	writeFileSync(join(dir, "src", "slug.ts"), "export const slugify = (t: string) => t;\n");
	const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
	git("init", "-q");
	git("add", ".");
	git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "start");
	return dir;
}

function setup(script: (task: string, cwd: string) => SubagentResult) {
	const root = mkdtempSync(join(tmpdir(), "pi-super-askrt-"));
	const agents = join(root, "agents");
	mkdirSync(agents);
	writeFileSync(join(agents, "worker.md"), "---\nname: worker\ndescription: w\n---\nWork.\n");
	const host: Host = { appendEntry() {}, getSessionName: () => "x", setSessionName() {} };
	const tasks: string[] = [];
	const runtime = new SuperRuntime(host, {
		bundledAgentsDir: agents,
		userAgentsDir: join(root, "none"),
		userRulesPath: join(root, "rules.json"),
		configDirName: ".pi",
		readFile: () => undefined,
		findProjectFile: () => undefined,
		findProjectDir: () => undefined,
		runAgent: async (request) => {
			tasks.push(request.task);
			return script(request.task, request.cwd);
		},
	});
	runtime.beginSession([], root);
	runtime.armLoop();
	return { runtime, tasks };
}

const drainIn = (runtime: SuperRuntime, cwd: string) =>
	runtime.drain({ cwd, agentScope: "trusted", projectTrusted: true, selector: "auto", hasUI: true });

const PROMPT = "实现 slugify。中文怎么处理还没想好，这点需要你问我。加 src/slug.test.ts，不要加依赖，不要 commit。";

describe("ask first at intake", () => {
	it("reads the person's constraints", () => {
		expect(detectConstraints(PROMPT)).toEqual({ askFirst: true, noNewDeps: true, noCommit: true });
		expect(detectConstraints("Add a parser. Do not commit. No new dependencies.")).toEqual({ noNewDeps: true, noCommit: true });
	});

	it("finds bare package imports", () => {
		expect(bareImports('import { test } from "vitest";\nimport a from "node:assert";\nimport fs from "fs";\nimport x from "./x.ts";\nimport y from "@scope/pkg/sub";')).toEqual(["vitest", "@scope/pkg"]);
	});

	it("refuses an ask-first ticket that carries no question", () => {
		const { runtime } = setup(() => result(READY));
		runtime.noteUserPrompt(PROMPT);
		const out = runtime.evalDecision({ title: "slug", scope: "slugify", strength: "explicit", decision: "accept", reason: "asked" });
		expect(out.isError).toBe(true);
		expect(out.text).toMatch(/^NOT ACCEPTED/);
		expect(runtime.state.tickets).toHaveLength(0);
	});

	it("opens the question at intake, waits, then resumes after super_answer", async () => {
		const dir = repo();
		const { runtime, tasks } = setup((_task, cwd) => {
			writeFileSync(join(cwd, "src", "slug.test.ts"), "// test\n");
			return result(READY);
		});
		runtime.noteUserPrompt(PROMPT);
		const out = runtime.evalDecision({
			title: "slug",
			scope: "slugify",
			strength: "explicit",
			decision: "accept",
			reason: "asked",
			cwd: dir,
			constraints: { files: ["src/slug.test.ts"] },
			ask: { title: "非 ASCII", text: "中文保留还是删除？", options: ["保留", "删除"] },
		});
		expect(out.text).toMatch(/waiting for the person/);
		const first = await drainIn(runtime, dir);
		expect(tasks).toHaveLength(0);
		expect(first.speech).toContain("中文保留还是删除？");
		expect(first.speech).toContain("1. 保留\n2. 删除");
		expect(runtime.answer(undefined, "1").ok).toBe(true);
		await drainIn(runtime, dir);
		expect(tasks[0]).toContain("Required file: src/slug.test.ts");
		expect(tasks[0]).toMatch(/Answers already given:\n- .*: 保留/);
		expect(runtime.state.tickets[0]?.outcome).toBe("completed");
	});
});

describe("one question per ticket", () => {
	it("turns a second worker question into a repair pass", async () => {
		const dir = repo();
		let calls = 0;
		const { runtime, tasks } = setup((_task, cwd) => {
			calls += 1;
			if (calls === 1) {
				return result('Need ok.\n```pi-super\n{"report":"ask","summary":"May I?","ask":{"title":"Create file?","text":"May I create it?","options":["Yes","No"],"key":"perm"}}\n```');
			}
			writeFileSync(join(cwd, "src", "slug.ts"), "export const slugify = (t: string) => t.toLowerCase();\n");
			return result(READY);
		});
		runtime.evalDecision({ title: "slug", scope: "slugify", strength: "explicit", decision: "accept", reason: "r", cwd: dir, ask: { title: "Q", text: "Keep?", options: ["keep", "drop"] } });
		runtime.answer(undefined, "keep");
		await drainIn(runtime, dir);
		expect(tasks[0]).toContain("Ask first: done");
		expect(runtime.state.facts.filter((fact) => fact.type === "attention.opened")).toHaveLength(1);
		expect(runtime.state.tickets[0]?.outcome).toBe("completed");
	});
});

describe("kernel constraint checks", () => {
	it("rejects ready when dependencies were added or a required file is elsewhere", async () => {
		const dir = repo();
		const { runtime } = setup((_task, cwd) => {
			writeFileSync(join(cwd, "package.json"), JSON.stringify({ devDependencies: { tsx: "^4" } }));
			mkdirSync(join(cwd, "test"), { recursive: true });
			writeFileSync(join(cwd, "test", "slug.test.ts"), "// test\n");
			return result(READY);
		});
		runtime.noteUserPrompt("Implement slugify. No new dependencies.");
		runtime.evalDecision({ title: "slug", scope: "slugify", strength: "explicit", decision: "accept", reason: "r", cwd: dir, constraints: { files: ["src/slug.test.ts"] } });
		await drainIn(runtime, dir);
		const ticket = runtime.state.tickets[0]!;
		expect(ticket.outcome).not.toBe("completed");
		expect(ticket.assignment?.summary).toContain("New dependencies were added against the mandate: tsx");
		expect(ticket.assignment?.summary).toContain("Required file src/slug.test.ts does not exist");
	});

	it("rejects a test that imports an undeclared package under no new dependencies", async () => {
		const dir = repo();
		const { runtime } = setup((_task, cwd) => {
			writeFileSync(join(cwd, "src", "slug.test.ts"), 'import { test } from "vitest";\nimport assert from "node:assert/strict";\n');
			return result(READY);
		});
		runtime.noteUserPrompt("Add src/slug.test.ts with node:test. 不要加依赖。");
		runtime.evalDecision({ title: "slug", scope: "slugify", strength: "explicit", decision: "accept", reason: "r", cwd: dir });
		await drainIn(runtime, dir);
		expect(runtime.state.tickets[0]?.assignment?.summary).toContain("vitest (src/slug.test.ts)");
	});

	it("rejects ready when nothing changed or a commit was made", async () => {
		const dir = repo();
		const { runtime } = setup(() => result(READY));
		runtime.evalDecision({ title: "slug", scope: "slugify", strength: "explicit", decision: "accept", reason: "r", cwd: dir, constraints: { noCommit: true } });
		await drainIn(runtime, dir);
		expect(runtime.state.tickets[0]?.assignment?.summary).toContain("No change in the tree");

		const dir2 = repo();
		const committed = setup((_task, cwd) => {
			writeFileSync(join(cwd, "src", "slug.ts"), "export const slugify = (t: string) => t.toLowerCase();\n");
			try {
				execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qam", "x"], { cwd, stdio: "ignore" });
			} catch {
				// Later passes have nothing new to commit.
			}
			return result(READY);
		});
		committed.runtime.evalDecision({ title: "slug", scope: "slugify", strength: "explicit", decision: "accept", reason: "r", cwd: dir2, constraints: { noCommit: true } });
		await drainIn(committed.runtime, dir2);
		expect(committed.runtime.state.tickets[0]?.assignment?.summary).toContain("A commit was made against the mandate");
	});
});

describe("truthful failures", () => {
	it("says the question was not sent when the ticket is closed", () => {
		const { runtime } = setup(() => result(READY));
		const text = runtime.recordReport("t9", "waiting", "need input", { title: "Q", text: "Which?", options: ["a", "b"], key: "q" });
		expect(text).toMatch(/^QUESTION NOT SENT/);
		expect(text).toContain("NOT asked");
	});
});
