/**
 * Acceptance run for pi-super against Kimi K2.8 (kimi-for-coding).
 *
 * The API key is read from KIMI_KEY_FILE or KIMI_API_KEY. It is passed to the
 * pi process through the environment and is never printed, written into this
 * repo, or placed on the command line.
 *
 * Usage:
 *   KIMI_KEY_FILE=/path/to/key.txt node scripts/accept.mjs
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const key = loadKey();
const redact = (text) => text.split(key).join("[REDACTED]");
const pi = join(root, "node_modules", ".bin", "pi");
const agentDir = join(tmpdir(), "pi-super-accept-agent");

rmSync(agentDir, { recursive: true, force: true });
mkdirSync(agentDir, { recursive: true });

const only = process.env.ACCEPT_ONLY;
const cents = only === "ask" ? undefined : await runCents();
const ask = only === "cents" ? undefined : await runAsk();
const summary = { cents, ask };
const rendered = JSON.stringify(summary, null, 2);
if (rendered.includes(key)) {
	console.error("redaction failed");
	process.exit(2);
}
console.log(rendered);
const centsOk = cents === undefined || cents.ok;
const askOk = ask === undefined || ask.ok;
process.exit(centsOk && askOk ? 0 : 1);

async function runCents() {
	const repo = join(tmpdir(), "pi-super-accept-cents");
	const sessionDir = join(tmpdir(), "pi-super-accept-cents-sessions");
	reset(repo, sessionDir);
	mkdirSync(join(repo, "src"), { recursive: true });
	mkdirSync(join(repo, ".pi", "super"), { recursive: true });
	writeFileSync(
		join(repo, "src", "cents.ts"),
		"export function formatCents(cents: number): string {\n\treturn String(cents);\n}\n",
	);
	writeFileSync(join(repo, ".pi", "super", "rules.json"), JSON.stringify({ hopLimit: 3, parallel: 1 }, null, 2));
	writeFileSync(join(repo, ".gitignore"), "node_modules\n");
	await git(repo, ["init"]);
	await git(repo, ["add", "."]);
	await git(repo, ["-c", "user.email=accept@example.com", "-c", "user.name=accept", "commit", "-m", "start"]);
	const prompt = [
		"formatCents must return a dollar string with two digits after the point.",
		'formatCents(199) must be "$1.99". formatCents(5) must be "$0.05". formatCents(-40) must be "-$0.40".',
		'Add parseCents. parseCents("$1.99") must be 199. parseCents("$0.05") must be 5. parseCents("-$0.40") must be -40.',
		"Add src/cents.test.ts using node:test and node:assert/strict with those six exact checks.",
		"Do not add dependencies. Do not commit.",
	].join(" ");
	const run = await runPi(repo, sessionDir, "cents", prompt, 12 * 60 * 1000);
	const src = readIf(join(repo, "src", "cents.ts"));
	const test = readIf(join(repo, "src", "cents.test.ts"));
	const behavior = await nodeEval(
		repo,
		[
			'import { formatCents, parseCents } from "./src/cents.ts";',
			'const checks = [formatCents(199)==="$1.99", formatCents(5)==="$0.05", formatCents(-40)==="-$0.40", parseCents("$1.99")===199, parseCents("$0.05")===5, parseCents("-$0.40")===-40];',
			"if (checks.some((ok) => !ok)) process.exit(1);",
		].join(""),
	);
	const receipt = lastReady(run.facts);
	const speech = lastReceiptMessage(run.events);
	const extras = quotesOutside(speech, receipt);
	return {
		ok:
			behavior.status === 0 &&
			extras.length === 0 &&
			run.agents.includes("reviewer") &&
			receipt.length > 0 &&
			speech.includes(receipt) &&
			!/returned "1\.99"/.test(speech),
		exitCode: run.exitCode,
		agents: run.agents,
		hops: run.hops,
		receipt,
		speech,
		quotesOutsideReceipt: extras,
		testHasAdaStandIn: /World|Alice/.test(test),
		testHasRequiredLiterals: ["$1.99", "$0.05", "-$0.40", "199", "-40"].every((bit) => test.includes(bit)),
		behaviorStatus: behavior.status,
		behaviorTail: redact(behavior.output).slice(-800),
		src: src.slice(0, 1200),
		logPath: run.logPath,
	};
}

async function runAsk() {
	const repo = join(tmpdir(), "pi-super-accept-ask");
	const sessionDir = join(tmpdir(), "pi-super-accept-ask-sessions");
	reset(repo, sessionDir);
	mkdirSync(join(repo, ".pi", "super"), { recursive: true });
	writeFileSync(join(repo, ".pi", "super", "rules.json"), JSON.stringify({ hopLimit: 3, parallel: 1 }, null, 2));
	writeFileSync(join(repo, ".gitignore"), "node_modules\n");
	await git(repo, ["init"]);
	await git(repo, ["add", "."]);
	await git(repo, ["-c", "user.email=accept@example.com", "-c", "user.name=accept", "commit", "-m", "start"]);
	const prompt = [
		"Add only src/pace.ts exporting pace(n: number): number.",
		"I have not decided whether pace(n) returns n or n * 2.",
		'Ask exactly one question. The only options are "keep" and "double".',
		"Do not write the file until I answer.",
		"After I answer, write only that file. Do not add package.json, a test runner, or a second question.",
	].join(" ");
	const first = await runPi(repo, sessionDir, "ask", prompt, 8 * 60 * 1000);
	const firstSpeech = lastReceiptMessage(first.events);
	const askedEarly = existsSync(join(repo, "src", "pace.ts"));
	const questions = first.facts.filter((fact) => fact.type === "attention.opened");
	const question = questions[0]?.attention;
	const second = await runPi(repo, sessionDir, "ask", "double", 10 * 60 * 1000);
	const pace = readIf(join(repo, "src", "pace.ts"));
	const doubled =
		existsSync(join(repo, "src", "pace.ts")) &&
		(await nodeEval(repo, 'import { pace } from "./src/pace.ts"; if (pace(2) !== 4 || pace(5) !== 10) process.exit(1);')).status === 0;
	return {
		ok:
			first.exitCode === 0 &&
			questions.length === 1 &&
			question?.options?.length === 2 &&
			question?.options?.[0] === "keep" &&
			question?.options?.[1] === "double" &&
			!askedEarly &&
			second.tools.includes("super_answer") &&
			doubled &&
			second.questionsSpoken <= 1 &&
			firstSpeech.includes(question?.text ?? "missing") &&
			firstSpeech.includes("1. keep") &&
			firstSpeech.includes("2. double") &&
			!firstSpeech.includes("other question"),
		firstExit: first.exitCode,
		questions: questions.map((fact) => ({
			title: fact.attention?.title,
			text: fact.attention?.text,
			options: fact.attention?.options,
		})),
		wroteBeforeAnswer: askedEarly,
		resumedWith: second.tools,
		pace,
		speech: firstSpeech,
		logPaths: [first.logPath, second.logPath],
	};
}

function reset(repo, sessionDir) {
	rmSync(repo, { recursive: true, force: true });
	rmSync(sessionDir, { recursive: true, force: true });
	mkdirSync(repo, { recursive: true });
	mkdirSync(sessionDir, { recursive: true });
}

async function runPi(repo, sessionDir, sessionId, prompt, timeoutMs) {
	const logPath = join(tmpdir(), `pi-super-accept-${sessionId}-${Date.now()}.log`);
	const args = [
		"--no-extensions",
		"-e",
		join(root, "extensions", "index.ts"),
		"--skill",
		join(root, "skills", "pi-super"),
		"--prompt-template",
		join(root, "prompts"),
		"--model",
		"kimi-coding/kimi-for-coding",
		"--thinking",
		"low",
		"--approve",
		"--mode",
		"json",
		"--session-dir",
		sessionDir,
		"--session-id",
		sessionId,
		"-p",
		"--",
		prompt,
	];
	const child = spawn(pi, args, {
		cwd: repo,
		env: { ...process.env, KIMI_API_KEY: key, PI_CODING_AGENT_DIR: agentDir },
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk) => {
		stdout += chunk.toString();
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk.toString();
	});
	const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
	const exitCode = await new Promise((resolve) => {
		child.on("close", (code) => resolve(code ?? 1));
		child.on("error", () => resolve(1));
	});
	clearTimeout(timer);
	const output = redact(`${stdout}\n${stderr}`);
	if (output.includes(key)) throw new Error("redaction failed");
	writeFileSync(logPath, output);
	const events = parseEvents(stdout);
	const facts = events
		.filter((event) => event.type === "entry_appended" && event.entry?.customType === "pi-super")
		.map((event) => event.entry.data)
		.filter(Boolean);
	const tools = events.filter((event) => event.type === "tool_execution_start").map((event) => event.toolName);
	const agents = facts.filter((fact) => fact.type === "assignment.started").map((fact) => fact.agent);
	const hops = facts.filter((fact) => fact.type === "assignment.started").map((fact) => fact.hops);
	const questionsSpoken = (lastReceiptMessage(events).match(/needs you:/g) ?? []).length;
	return { exitCode, events, facts, tools, agents, hops, questionsSpoken, logPath };
}

function parseEvents(stdout) {
	const events = [];
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) continue;
		try {
			events.push(JSON.parse(trimmed));
		} catch {
			// Partial lines stay in the redacted log.
		}
	}
	return events;
}

function lastReady(facts) {
	const ready = facts.filter((fact) => fact.type === "report.recorded" && fact.kind === "ready");
	return ready.at(-1)?.summary ?? "";
}

function lastReceiptMessage(events) {
	const messages = events.filter(
		(event) => event.type === "entry_appended" && event.entry?.customType === "pi-super-result" && event.entry.display === true,
	);
	return messages.at(-1)?.entry?.content ?? "";
}

function quotesOutside(speech, receipt) {
	const found = [...speech.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
	return found.filter((item) => item && !receipt.includes(item));
}

function readIf(path) {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

function nodeEval(cwd, source) {
	return new Promise((resolve) => {
		const test = spawn(process.execPath, ["--experimental-strip-types", "-e", source], {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		test.stdout.on("data", (chunk) => {
			output += chunk.toString();
		});
		test.stderr.on("data", (chunk) => {
			output += chunk.toString();
		});
		test.on("close", (status) => resolve({ status: status ?? 1, output }));
		test.on("error", (error) => resolve({ status: 1, output: error.message }));
	});
}

function git(cwd, args) {
	return new Promise((resolve, reject) => {
		const child = spawn("git", args, { cwd, stdio: "ignore" });
		child.on("close", (status) => (status === 0 ? resolve() : reject(new Error(`git ${args.join(" ")} failed`))));
		child.on("error", reject);
	});
}

function loadKey() {
	if (process.env.KIMI_KEY_FILE) return readFileSync(process.env.KIMI_KEY_FILE, "utf8").trim();
	if (process.env.KIMI_API_KEY) return process.env.KIMI_API_KEY.trim();
	throw new Error("Set KIMI_KEY_FILE or KIMI_API_KEY");
}
