/**
 * Real-model acceptance for pi-super v0.3 against Kimi K2.8 (kimi-for-coding).
 *
 * Five scenarios: ask-first, multi-file refactor, non-code writing task, a split multi-ticket run,
 * and a task that must end blocked. Each gets a fresh git repo and a fresh session.
 *
 * The API key is read from KIMI_KEY_FILE or KIMI_API_KEY. It is passed to pi through the
 * environment only, never printed, and redacted from the saved logs.
 *
 * Usage:
 *   KIMI_KEY_FILE=/path/to/key.txt node scripts/accept.mjs            # all scenarios
 *   ACCEPT_ONLY=ask,blocked KIMI_KEY_FILE=... node scripts/accept.mjs # a subset
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const key = loadKey();
function redact(text) {
	return text.split(key).join("[REDACTED]");
}
const pi = join(root, "node_modules", ".bin", "pi");
const base = join(tmpdir(), "pi-super-accept");
const agentDir = join(base, "agent");
rmSync(base, { recursive: true, force: true });
mkdirSync(agentDir, { recursive: true });

const SCENARIOS = { ask, refactor, writing, split, blocked, timeout, restart };
const only = process.env.ACCEPT_ONLY?.split(",").map((name) => name.trim()).filter(Boolean);
const names = only?.length ? only : Object.keys(SCENARIOS);
const results = await Promise.all(names.map(async (name) => [name, await SCENARIOS[name]()]));
const summary = Object.fromEntries(results);
const rendered = JSON.stringify(summary, null, 2);
if (rendered.includes(key)) {
	console.error("redaction failed");
	process.exit(2);
}
console.log(rendered);
process.exit(results.every(([, result]) => result.ok) ? 0 : 1);

// --- scenarios -----------------------------------------------------------

async function ask() {
	const s = scenario("ask", { "package.json": '{"name":"slug","type":"module","scripts":{"test":"node --test"}}\n' });
	const first = await s.turn(
		'写 src/slugify.js：导出 slugify(str)，小写，去掉首尾空白，非字母数字的连续字符变成一个分隔符，去掉首尾分隔符；中文字符保留。配套 src/slugify.test.js 用 node:test，至少覆盖 slugify("  Hello, World!  ") 和 slugify("--a--")。不要加任何依赖，不要 commit。分隔符用 "-" 还是 "_" 需要你先问我。',
	);
	const askedOnce = first.facts.filter((fact) => fact.type === "attention.opened").length === 1;
	const noWorkBeforeAnswer = !first.facts.some((fact) => fact.type === "assignment.started");
	const questionShownOnce = count(first.speech, "分隔符") >= 1 && count(first.speech, "1.") === 1;
	await s.turn("用 -");
	const values = nodeEval(s.repo, 'import("./src/slugify.js").then(m=>console.log(JSON.stringify([m.slugify("  Hello, World!  "),m.slugify("--a--"),m.slugify("你好 世界!")])))');
	const checks = {
		askedOnce,
		noWorkBeforeAnswer,
		questionShownOnce,
		values: values === '["hello-world","a","你好-世界"]',
		testsPass: run(s.repo, "npm", ["test"]) === 0,
		noDeps: !/"(dev)?[dD]ependencies"/.test(readIf(join(s.repo, "package.json"))),
		noCommit: commits(s.repo) === 1,
	};
	return s.done(checks, { values });
}

async function refactor() {
	const files = { "package.json": '{"name":"shop","type":"module","scripts":{"test":"node --test"}}\n' };
	for (const name of ["order", "invoice", "receipt"]) {
		files[`src/${name}.js`] =
			'function pad(n){return String(n).padStart(2,"0");}\n' +
			'function fmtDate(d){return d.getUTCFullYear()+"-"+pad(d.getUTCMonth()+1)+"-"+pad(d.getUTCDate());}\n' +
			`export function ${name}Line(item){ return fmtDate(item.date)+" ${name} "+item.id; }\n`;
		files[`test/${name}.test.js`] =
			`import test from "node:test"; import assert from "node:assert/strict"; import { ${name}Line } from "../src/${name}.js";\n` +
			`test("${name}", ()=>assert.equal(${name}Line({date:new Date(Date.UTC(2026,0,5)),id:7}),"2026-01-05 ${name} 7"));\n`;
	}
	const s = scenario("refactor", files);
	await s.turn("src/order.js、src/invoice.js、src/receipt.js 里各有一份重复的 pad/fmtDate。把它们抽到 src/lib/date.js（导出 formatDate），三个文件改成 import，删掉重复代码。npm test 必须仍然全过，行为不变，不要改测试。");
	const sources = ["order", "invoice", "receipt"].map((name) => readIf(join(s.repo, "src", `${name}.js`)));
	const checks = {
		ready: lastReport(s.facts(), "t1") === "ready",
		shared: existsSync(join(s.repo, "src", "lib", "date.js")),
		imported: sources.every((text) => text.includes("lib/date.js") && !text.includes("function fmtDate")),
		testsUntouched: changedPaths(s.repo).every((path) => !path.startsWith("test/")),
		testsPass: run(s.repo, "npm", ["test"]) === 0,
	};
	return s.done(checks);
}

async function writing() {
	const s = scenario("writing", {
		"notes/sqlite.md": "SQLite: embedded, single file, zero config. Writes serialize on one writer lock (WAL allows concurrent readers). Great for apps under ~100k writes/day, edge, tests. No user management. Backup = copy the file (or .backup).\n",
		"notes/postgres.md": "PostgreSQL: client-server, MVCC, many concurrent writers, rich types (jsonb, arrays), extensions (PostGIS, pgvector). Needs ops: backups (pg_dump / PITR), connection pooling (pgbouncer), upgrades.\n",
		"notes/team.md": "Our situation: 3 engineers, internal admin tool, ~200 users, ~5k writes/day, one VM, nobody wants to run a DB server. Might add a public API next year.\n",
	});
	await s.turn('读 notes/ 下的三份笔记，帮我们团队写一份中文选型建议 docs/db-decision.md：结论放第一段（SQLite 还是 PostgreSQL），然后是对比表（至少包含并发写、运维成本、备份、扩展性四行），最后一节"何时重新评估"。只能依据笔记里的事实，不要编造数字。');
	const doc = readIf(join(s.repo, "docs", "db-decision.md"));
	const notes = ["sqlite", "postgres", "team"].map((name) => readIf(join(s.repo, "notes", `${name}.md`))).join("\n");
	// Every number in the document must come from the notes ("10 万" is the notes' "100k").
	const numbers = [...doc.replace(/^\s*\d+\.\s/gm, "").matchAll(/\d+/g)].map((match) => match[0]);
	const allowed = new Set([...notes.matchAll(/\d+/g)].map((match) => match[0]).concat(["10"]));
	const checks = {
		ready: lastReport(s.facts(), "t1") === "ready",
		lane: s.facts().some((fact) => fact.type === "ticket.created" && fact.ticket.lane === "task"),
		conclusionFirst: /SQLite|PostgreSQL/.test(doc.split(/\n\s*\n/).find((part) => part.trim() && !part.trim().startsWith("#")) ?? ""),
		tableRows: ["并发写", "运维", "备份", "扩展"].every((word) => doc.split("\n").some((line) => line.startsWith("|") && line.includes(word))),
		reevaluate: doc.includes("何时重新评估"),
		numbersFromNotes: numbers.every((number) => allowed.has(number)),
	};
	return s.done(checks, { numbers });
}

async function split() {
	const s = scenario("split", {
		"package.json": '{"name":"todo-cli","version":"0.1.0","type":"module","bin":{"todo":"src/cli.js"},"scripts":{"test":"node --test"}}\n',
		"src/store.js":
			'import { readFileSync, writeFileSync, existsSync } from "node:fs";\n' +
			'export function load(path){ return existsSync(path) ? JSON.parse(readFileSync(path,"utf8")) : []; }\n' +
			"export function save(path, items){ writeFileSync(path, JSON.stringify(items, null, 2)); }\n",
		"src/cli.js": '#!/usr/bin/env node\nconsole.log("todo: not implemented");\n',
	});
	await s.turn("给这个 todo CLI 做三件事：1) src/cli.js 支持 `todo add <text>`、`todo list`、`todo done <n>`，数据存在 ./todo.json（用 src/store.js）；2) 为 cli 写 node:test 测试 test/cli.test.js（用子进程跑，临时目录）；3) 写 README.md 说明三个命令。前三件都完成后，再把 package.json 的 version 改成 0.2.0。不要加依赖。");
	const facts = s.facts();
	const created = facts.filter((fact) => fact.type === "ticket.created").map((fact) => fact.ticket);
	const bump = created.find((ticket) => /0\.2\.0|version|版本/.test(ticket.title));
	const started = facts.filter((fact) => fact.type === "assignment.started").map((fact) => fact.ticketId);
	const others = created.filter((ticket) => ticket !== bump).map((ticket) => ticket.id);
	const pkg = JSON.parse(readIf(join(s.repo, "package.json")) || "{}");
	const checks = {
		split: created.length >= 2,
		noIntakeQuestion: !facts.some((fact) => fact.type === "attention.opened"),
		bumpWaits: Boolean(bump?.after?.length),
		bumpLast: bump ? started.indexOf(bump.id) > Math.max(...others.map((id) => started.lastIndexOf(id))) : false,
		version: pkg.version === "0.2.0",
		noDeps: !pkg.dependencies && !pkg.devDependencies,
		readme: existsSync(join(s.repo, "README.md")),
		testsPass: run(s.repo, "npm", ["test"]) === 0,
	};
	return s.done(checks, { tickets: created.map((ticket) => `${ticket.id}${ticket.after?.length ? `<-${ticket.after}` : ""}: ${ticket.title}`) });
}

async function blocked() {
	const s = scenario("blocked", { "package.json": '{"name":"report"}\n', "data/sales-2024.csv": "month,revenue\n2024-01,100\n2024-02,120\n" });
	await s.turn("用 data/sales-2025.csv 按季度汇总 2025 年收入，写到 reports/q-2025.md。只能用这份 2025 的数据，别拿别的年份凑。");
	const facts = s.facts();
	const kinds = facts.filter((fact) => fact.type === "report.recorded").map((fact) => fact.kind);
	const lane = facts.filter((fact) => fact.type === "assignment.started").map((fact) => fact.agent);
	const checks = {
		endedWaiting: kinds.at(-1) === "blocked" || kinds.at(-1) === "failed" || facts.some((fact) => fact.type === "attention.opened"),
		neverReady: !kinds.includes("ready"),
		noFabricatedReport: !existsSync(join(s.repo, "reports", "q-2025.md")),
		laneStoppedEarly: lane.length < 4 || kinds.indexOf("blocked") === kinds.length - 1,
	};
	return s.done(checks, { kinds, lane });
}

async function timeout() {
	// A 15-second step deadline on a task that takes longer: the kernel must stop the run, retry once, and then
	// either finish or say plainly how to run it again. It must never hang.
	const s = scenario("timeout", {
		"package.json": '{"name":"t","type":"module","scripts":{"test":"node --test"}}\n',
		".pi/super/rules.json": '{"stepTimeoutMinutes":0.25}\n',
	});
	const started = Date.now();
	const out = await s.turn("写 src/roman.js：导出 toRoman(n) 和 fromRoman(s)，支持 1..3999，非法输入抛 RangeError；配 src/roman.test.js（node:test），覆盖 1、4、9、14、40、90、400、1994、3999 的双向转换和非法输入。");
	const facts = s.facts();
	const retried = facts.some((fact) => fact.type === "notice.recorded" && fact.title === "Retried" && /timed out/.test(fact.text));
	const outcome = lastReport(facts, "t1") === "ready" ? "completed" : undefined;
	const last = facts.filter((fact) => fact.type === "report.recorded").at(-1);
	const checks = {
		retried,
		settled: outcome === "completed" || (last?.kind === "failed" && /\/super run/.test(last.summary)) || last?.kind === "progress",
		bounded: Date.now() - started < 20 * 60_000,
		honest: outcome !== "completed" || run(s.repo, "npm", ["test"]) === 0,
	};
	return s.done(checks, { outcome, last: last?.kind, speech: out.speech.slice(-300) });
}

async function restart() {
	// Kill pi (and its workers) mid-run, then start it again on the same session: the interrupted assignment must be
	// recovered from the ledger and the ticket must finish.
	const s = scenario("restart", { "package.json": '{"name":"r","type":"module","scripts":{"test":"node --test"}}\n' });
	await s.turn("写 src/wordcount.js：导出 wordCount(text) 返回 {词: 次数}，忽略大小写和标点；配 src/wordcount.test.js（node:test）覆盖空串、标点、大小写。不要加依赖。", { killAfterMs: 45_000 });
	const interrupted = s.facts().some((fact) => fact.type === "assignment.started");
	await s.turn("继续");
	const facts = s.facts();
	const checks = {
		interrupted,
		recovered: facts.some((fact) => fact.type === "notice.recorded" && fact.title === "Recovered"),
		completed: lastReport(facts, "t1") === "ready",
		oneTicket: facts.filter((fact) => fact.type === "ticket.created").length === 1,
		testsPass: run(s.repo, "npm", ["test"]) === 0,
	};
	return s.done(checks);
}

// --- harness -------------------------------------------------------------

function scenario(name, files) {
	const repo = join(base, name);
	const sessionDir = join(base, `${name}-sessions`);
	mkdirSync(repo, { recursive: true });
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(join(repo, path, ".."), { recursive: true });
		writeFileSync(join(repo, path), text);
	}
	run(repo, "git", ["init", "-q"]);
	run(repo, "git", ["add", "."]);
	run(repo, "git", ["-c", "user.email=accept@example.com", "-c", "user.name=accept", "commit", "-qm", "start"]);
	const turns = [];
	const facts = () => readFacts(sessionDir);
	return {
		repo,
		facts,
		async turn(prompt, options = {}) {
			const before = facts().length;
			const out = await runPi(repo, sessionDir, name, prompt, turns.length, options.killAfterMs);
			const turn = { ...out, facts: facts().slice(before) };
			turns.push(turn);
			return turn;
		},
		done(checks, extra = {}) {
			return { ok: Object.values(checks).every(Boolean), checks, ...extra, logs: turns.map((turn) => turn.logPath) };
		},
	};
}

async function runPi(repo, sessionDir, name, prompt, index, killAfterMs) {
	const logPath = join(base, `${name}-${index + 1}.log`);
	const args = ["--no-extensions", "-e", join(root, "extensions", "index.ts"), "--skill", join(root, "skills", "pi-super"), "--prompt-template", join(root, "prompts"),
		"--model", "kimi-coding/kimi-for-coding", "--thinking", "low", "--approve", "--mode", "json",
		"--session-dir", sessionDir, "--session-id", "main", "-p", "--", prompt];
	const child = spawn(pi, args, { cwd: repo, env: { ...process.env, KIMI_API_KEY: key, PI_CODING_AGENT_DIR: agentDir }, stdio: ["ignore", "pipe", "pipe"], detached: true });
	// Simulate a crash: kill the whole process group, workers included.
	const crash = killAfterMs ? setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, killAfterMs) : undefined;
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
	child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
	const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGTERM"); } catch {} }, 1_500_000);
	const exitCode = await new Promise((resolve) => {
		child.on("close", (code) => resolve(code ?? 1));
		child.on("error", () => resolve(1));
	});
	clearTimeout(timer);
	if (crash) clearTimeout(crash);
	const output = redact(`${stdout}\n${stderr}`);
	if (output.includes(key)) throw new Error("redaction failed");
	writeFileSync(logPath, output);
	return { exitCode, speech: assistantText(stdout), logPath };
}

function readFacts(sessionDir) {
	if (!existsSync(sessionDir)) return [];
	const facts = [];
	for (const file of readdirSync(sessionDir).filter((name) => name.endsWith(".jsonl"))) {
		for (const line of readFileSync(join(sessionDir, file), "utf8").split("\n")) {
			if (!line.trim()) continue;
			try {
				const entry = JSON.parse(line);
				if (entry.type === "custom" && entry.customType === "pi-super" && entry.data) facts.push(entry.data);
			} catch {}
		}
	}
	return facts;
}

function assistantText(stdout) {
	const texts = [];
	for (const line of stdout.split("\n")) {
		if (!line.trim().startsWith("{")) continue;
		try {
			const event = JSON.parse(line);
			if (event.type === "message_end" && event.message?.role === "assistant") {
				for (const part of event.message.content ?? []) if (part.type === "text") texts.push(part.text);
			}
		} catch {}
	}
	return texts.join("\n");
}

function lastReport(facts, id) {
	return facts.filter((fact) => fact.type === "report.recorded" && fact.ticketId === id).at(-1)?.kind;
}
function count(text, needle) {
	return text.split(needle).length - 1;
}
function readIf(path) {
	return existsSync(path) ? readFileSync(path, "utf8") : "";
}
function run(cwd, cmd, args) {
	return spawnSync(cmd, args, { cwd, stdio: "ignore", timeout: 120_000 }).status ?? 1;
}
function commits(cwd) {
	return Number(spawnSync("git", ["rev-list", "--count", "HEAD"], { cwd, encoding: "utf8" }).stdout.trim());
}
function changedPaths(cwd) {
	return spawnSync("git", ["status", "--porcelain", "-uall"], { cwd, encoding: "utf8" }).stdout.split("\n").filter(Boolean).map((line) => line.slice(3));
}
function nodeEval(cwd, source) {
	return spawnSync("node", ["--input-type=module", "-e", source], { cwd, encoding: "utf8", timeout: 30_000 }).stdout.trim();
}

function loadKey() {
	if (process.env.KIMI_KEY_FILE) return readFileSync(process.env.KIMI_KEY_FILE, "utf8").trim();
	if (process.env.KIMI_API_KEY) return process.env.KIMI_API_KEY.trim();
	throw new Error("Set KIMI_KEY_FILE or KIMI_API_KEY");
}
