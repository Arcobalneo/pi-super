import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { interpretOutput } from "../extensions/receipt.ts";
import { SuperRuntime, type Host } from "../extensions/runtime.ts";
import { buildSubagentArgs } from "../extensions/pi-command.ts";
import { verifyReady } from "../extensions/verify.ts";
import type { SubagentResult } from "../extensions/types.ts";

const res = (text: string): SubagentResult => ({
	agent: "worker",
	exitCode: 0,
	text,
	stderr: "",
	usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1 },
	aborted: false,
});
const receipt = (body: object, prose = "Done.") => res(`${prose}\n\`\`\`pi-super\n${JSON.stringify(body)}\n\`\`\``);

function repo(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-super-gen-"));
	writeFileSync(join(dir, "a.txt"), "a\n");
	const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
	git("init", "-q");
	git("add", ".");
	git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "start");
	return dir;
}

function setup(script: (task: string, call: number, request: { session?: { dir: string; id: string } }) => SubagentResult) {
	const root = mkdtempSync(join(tmpdir(), "pi-super-genrt-"));
	const agents = join(root, "agents");
	mkdirSync(agents);
	writeFileSync(join(agents, "worker.md"), "---\nname: worker\ndescription: w\n---\nWork.\n");
	const host: Host = { appendEntry() {}, getSessionName: () => "x", setSessionName() {} };
	const tasks: string[] = [];
	const sessions: string[] = [];
	const runtime = new SuperRuntime(host, {
		bundledAgentsDir: agents,
		userAgentsDir: join(root, "none"),
		userRulesPath: join(root, "rules.json"),
		configDirName: ".pi",
		sessionRoot: join(root, "sessions"),
		readFile: () => undefined,
		findProjectFile: () => undefined,
		findProjectDir: () => undefined,
		runAgent: async (request) => {
			tasks.push(request.task);
			if (request.session) sessions.push(request.session.id);
			return script(request.task, tasks.length, request);
		},
	});
	runtime.beginSession([], root);
	runtime.armLoop();
	return { runtime, tasks, sessions };
}

const drain = (runtime: SuperRuntime, cwd: string) =>
	runtime.drain({ cwd, agentScope: "trusted", projectTrusted: true, selector: "auto", hasUI: true });

describe("the person's words are the mandate", () => {
	it("hands the verbatim request to the worker and keeps the Router note as background", async () => {
		const dir = repo();
		const { runtime, tasks } = setup(() => receipt({ report: "ready", summary: "ok", checks: ["true"], changed: ["a.txt"] }));
		writeFileSync(join(dir, "a.txt"), "b\n");
		runtime.noteUserPrompt("Rename the button to Save. Keep the old CSS class.");
		runtime.evalDecision({ title: "Button", note: "settings page", strength: "explicit", decision: "accept", reason: "asked" });
		await drain(runtime, dir);
		expect(tasks[0]).toContain("> Rename the button to Save. Keep the old CSS class.");
		expect(tasks[0]).toContain("Router note (routing background only, not a requirement): settings page");
	});

	it("attaches a follow-up verbatim to the same ticket, reopens it, and keeps the role session", async () => {
		const dir = repo();
		const { runtime, tasks, sessions } = setup(() => {
			writeFileSync(join(dir, "a.txt"), `v${Math.random()}\n`);
			return receipt({ report: "ready", summary: "ok", checks: ["true"], changed: ["a.txt"] });
		});
		runtime.noteUserPrompt("Write a.txt with a greeting.");
		runtime.evalDecision({ title: "Greeting", strength: "explicit", decision: "accept", reason: "asked" });
		await drain(runtime, dir);
		expect(runtime.state.tickets[0]?.outcome).toBe("completed");
		runtime.noteUserPrompt("Actually make it formal.");
		const out = runtime.evalDecision({ title: "Greeting", strength: "explicit", decision: "attach", ticketId: "t1", reason: "follow-up" });
		expect(out.text).toMatch(/^Attached to t1/);
		expect(runtime.state.tickets).toHaveLength(1);
		await drain(runtime, dir);
		expect(tasks[1]).toContain("> Actually make it formal.");
		expect(sessions).toEqual(["t1-worker", "t1-worker"]);
	});
});

describe("questions", () => {
	it("asks at intake, replies with the question only once, and does not deliver it twice", async () => {
		const dir = repo();
		const { runtime, tasks } = setup(() => receipt({ report: "ready", summary: "ok", checks: ["true"], changed: ["a.txt"] }));
		runtime.noteUserPrompt("Pick a color for the theme; ask me first.");
		const out = runtime.evalDecision({
			title: "Theme",
			strength: "explicit",
			decision: "accept",
			reason: "asked",
			ask: { title: "颜色？", text: "用哪种主色？", options: ["蓝", "绿"], recommend: 0 },
		});
		expect(out.text).toContain("颜色？\n用哪种主色？\n1. 蓝（推荐 / recommended）\n2. 绿");
		const first = await drain(runtime, dir);
		expect(tasks).toHaveLength(0);
		expect(first.speech).toBeUndefined();
	});

	it("never asks the same key twice: an answered decision is fed back instead", async () => {
		const dir = repo();
		const { runtime, tasks } = setup((_task, call) => {
			if (call === 1) return receipt({ report: "ask", summary: "need", ask: { title: "Tone", text: "Formal?", options: ["yes", "no"], key: "tone" } });
			if (call === 2) return receipt({ report: "ask", summary: "again", ask: { title: "Tone", text: "Formal, really?", options: ["yes", "no"], key: "tone" } });
			writeFileSync(join(dir, "a.txt"), "formal\n");
			return receipt({ report: "ready", summary: "ok", checks: ["true"], changed: ["a.txt"] });
		});
		runtime.noteUserPrompt("Write a.txt.");
		runtime.evalDecision({ title: "A", strength: "explicit", decision: "accept", reason: "asked" });
		await drain(runtime, dir);
		runtime.answer(undefined, "yes");
		await drain(runtime, dir);
		expect(tasks[1]).toContain("Decided by the person");
		expect(tasks[2]).toContain("Already decided by the person (Tone): yes");
		expect(runtime.state.tickets[0]?.outcome).toBe("completed");
	});
});

describe("grounded ready", () => {
	it("replays the receipt's checks and rejects ready when one fails", async () => {
		const dir = repo();
		writeFileSync(join(dir, "a.txt"), "changed\n");
		expect(await verifyReady({ cwd: dir, lane: "code", checks: ["grep -q changed a.txt"], changed: ["a.txt"], request: "" })).toEqual([]);
		const bad = await verifyReady({ cwd: dir, lane: "task", checks: ["grep -q missing a.txt"], changed: ["a.txt"], request: "" });
		expect(bad[0]).toMatch(/Check `grep -q missing a.txt` exited 1/);
	});

	it("requires checks and changed files for a deliverable, and a real change", async () => {
		const dir = repo();
		const none = await verifyReady({ cwd: dir, lane: "code", checks: [], changed: [], request: "" });
		expect(none.join(" ")).toMatch(/lists no checks/);
		expect(none.join(" ")).toMatch(/lists no changed files/);
		const untouched = await verifyReady({ cwd: dir, lane: "code", checks: ["true"], changed: ["b.txt"], request: "" });
		expect(untouched.join(" ")).toMatch(/b.txt does not exist/);
		expect(await verifyReady({ cwd: dir, lane: "review", checks: [], changed: [], request: "" })).toEqual([]);
	});

	it("sends an ungrounded ready back instead of delivering it", async () => {
		const dir = repo();
		const { runtime } = setup((_task, call) => {
			if (call <= 2) return receipt({ report: "ready", summary: "all good" });
			writeFileSync(join(dir, "a.txt"), "done\n");
			return receipt({ report: "ready", summary: "a.txt written", checks: ["grep -q done a.txt"], changed: ["a.txt"] });
		});
		runtime.noteUserPrompt("Write done into a.txt.");
		runtime.evalDecision({ title: "A", strength: "explicit", decision: "accept", reason: "asked" });
		const out = await drain(runtime, dir);
		expect(runtime.state.tickets[0]?.outcome).toBe("completed");
		expect(out.speech).toContain("a.txt written");
		expect(out.speech).not.toContain("all good");
	});
});

describe("receipts", () => {
	it("keeps the whole summary and reads a json-labelled block", () => {
		const text = 'Checked.\n```json\n{"report":"ready","summary":"All criteria verified:\\n- a\\n- b","checks":["true"],"changed":["x"]}\n```';
		const read = interpretOutput(text, 0, "");
		expect(read.report).toBe("ready");
		expect(read.summary).toBe("All criteria verified:\n- a\n- b");
		expect(read.checks).toEqual(["true"]);
	});

	it("falls back to the last whole paragraph, never a cut first line", () => {
		const read = interpretOutput("Notes.\n\nAll criteria verified:\n- a passes\n- b passes", 0, "");
		expect(read.summary).toBe("All criteria verified:\n- a passes\n- b passes");
		expect(read.receiptMissing).toBe(true);
	});

	it("asks the same session to rewrite a missing receipt once", async () => {
		const dir = repo();
		const { runtime, tasks } = setup((task) => {
			if (task.includes("could not be read")) {
				writeFileSync(join(dir, "a.txt"), "z\n");
				return receipt({ report: "ready", summary: "rewritten", checks: ["true"], changed: ["a.txt"] });
			}
			return res("I did it.");
		});
		runtime.noteUserPrompt("Do it.");
		runtime.evalDecision({ title: "A", strength: "explicit", decision: "accept", reason: "asked" });
		await drain(runtime, dir);
		expect(tasks[1]).toContain("could not be read");
		expect(runtime.state.tickets[0]?.assignment?.summary).toBe("rewritten");
	});
});

describe("several tickets", () => {
	it("runs after-dependencies in order and blocks a ticket whose dependency failed", async () => {
		const dir = repo();
		const order: string[] = [];
		const { runtime } = setup((task) => {
			const id = /Ticket: (t\d+)/.exec(task)?.[1] ?? "?";
			order.push(id);
			if (id === "t3") return receipt({ report: "failed", summary: "cannot" });
			writeFileSync(join(dir, `${id}.txt`), id);
			return receipt({ report: "ready", summary: `${id} ok`, checks: ["true"], changed: [`${id}.txt`] });
		});
		runtime.noteUserPrompt("Do A, then B. Separately C, then D.");
		runtime.evalDecision({ title: "A", strength: "explicit", decision: "accept", reason: "r" });
		runtime.evalDecision({ title: "B", strength: "explicit", decision: "accept", reason: "r", after: ["t1"] });
		runtime.evalDecision({ title: "C", strength: "explicit", decision: "accept", reason: "r" });
		runtime.evalDecision({ title: "D", strength: "explicit", decision: "accept", reason: "r", after: ["t3"] });
		const out = await drain(runtime, dir);
		expect(order.indexOf("t2")).toBeGreaterThan(order.indexOf("t1"));
		expect(order).not.toContain("t4");
		expect(runtime.state.tickets.find((t) => t.id === "t2")?.outcome).toBe("completed");
		expect(runtime.state.tickets.find((t) => t.id === "t4")?.assignment?.reportKind).toBe("blocked");
		expect(out.speech).toContain("t4 blocked.");
		expect(runtime.recall("t1")).toContain("related: t2");
	});
});

describe("sessions", () => {
	it("continues a role's session instead of --no-session when one is given", () => {
		const args = buildSubagentArgs({ trust: "approve", task: "x", session: { dir: "/s", id: "t1-worker" } });
		expect(args).toContain("--session-id");
		expect(args).not.toContain("--no-session");
	});
});

describe("split requests", () => {
	it("tells each split ticket what its siblings own, and keeps the request when the message was only an answer", async () => {
		const dir = repo();
		const { runtime, tasks } = setup((task) => {
			const id = /Ticket: (t\d+)/.exec(task)?.[1] ?? "x";
			writeFileSync(join(dir, `${id}.txt`), id);
			return receipt({ report: "ready", summary: id, checks: ["true"], changed: [`${id}.txt`] });
		});
		runtime.noteUserPrompt("Build the CLI, then bump the version. Ask me which flag style.");
		runtime.evalDecision({ title: "CLI", strength: "explicit", decision: "accept", reason: "r", ask: { title: "Flags", text: "Style?", options: ["--long", "-s"] } });
		runtime.noteUserPrompt("1");
		runtime.answer(undefined, "1");
		runtime.evalDecision({ title: "Version bump", strength: "explicit", decision: "accept", reason: "r", after: ["t1"] });
		expect(runtime.state.tickets[1]?.inputs[0]?.text).toBe("Build the CLI, then bump the version. Ask me which flag style.");
		await drain(runtime, dir);
		expect(tasks[0]).toContain("This ticket covers only: CLI");
		expect(tasks[0]).toContain("t2 (open): Version bump");
	});
});

describe("router questions", () => {
	it("refuses a second question written by the Router while one is open, and accepts free-text answers", async () => {
		const dir = repo();
		const { runtime } = setup(() => receipt({ report: "blocked", summary: "no file", ask: { title: "File?", text: "Provide it?", options: ["yes", "cancel"], key: "file" } }));
		runtime.noteUserPrompt("Summarize data/x.csv.");
		runtime.evalDecision({ title: "X", strength: "explicit", decision: "accept", reason: "r" });
		await drain(runtime, dir);
		runtime.noteUserPrompt("I can't get that file right now.");
		const refused = runtime.recordReport("t1", "blocked", "still", { title: "Next?", text: "What now?", options: ["a", "b"], key: "next" });
		expect(refused).toMatch(/^NOT RECORDED/);
		expect(runtime.answer("t1", "I can't get that file right now.").ok).toBe(true);
		expect(runtime.state.tickets[0]?.answers.at(-1)?.choice).toBe("I can't get that file right now.");
	});
});
