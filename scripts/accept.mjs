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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const key = loadKey();
const redact = (text) => text.split(key).join("[REDACTED]");
const agentDir = join(tmpdir(), "pi-super-accept-agent");
const sessionDir = join(tmpdir(), "pi-super-accept-sessions");
const repo = join(tmpdir(), "pi-super-accept-repo");
const logPath = join(tmpdir(), "pi-super-accept.log");

rmSync(agentDir, { recursive: true, force: true });
rmSync(sessionDir, { recursive: true, force: true });
rmSync(repo, { recursive: true, force: true });
mkdirSync(agentDir, { recursive: true });
mkdirSync(sessionDir, { recursive: true });
mkdirSync(join(repo, "src"), { recursive: true });
mkdirSync(join(repo, ".pi", "super"), { recursive: true });
writeFileSync(join(repo, "src", "greet.ts"), "export function greet(name: string): string {\n\treturn name;\n}\n");
writeFileSync(join(repo, ".pi", "super", "rules.json"), JSON.stringify({ hopLimit: 2, parallel: 1 }, null, 2));
writeFileSync(join(repo, ".gitignore"), "node_modules\n");
await git(repo, ["init"]);
await git(repo, ["add", "src/greet.ts", ".pi/super/rules.json", ".gitignore"]);
await git(repo, ["-c", "user.email=accept@example.com", "-c", "user.name=accept", "commit", "-m", "start"]);

const prompt = [
	"Change greet so it returns exactly Hello, then the name, then an exclamation mark.",
	'Add src/greet.test.ts that uses node:test and node:assert/strict.',
	'The test must check greet("Ada") === "Hello, Ada!".',
	"Do not add dependencies. Do not commit. Do not ask a question unless the mandate is impossible.",
].join(" ");

const pi = join(root, "node_modules", ".bin", "pi");
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
	"-p",
	"--",
	prompt,
];

const child = spawn(pi, args, {
	cwd: repo,
	env: {
		...process.env,
		KIMI_API_KEY: key,
		PI_CODING_AGENT_DIR: agentDir,
	},
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

const timer = setTimeout(() => {
	child.kill("SIGTERM");
}, 15 * 60 * 1000);

const exitCode = await new Promise((resolve) => {
	child.on("close", (code) => resolve(code ?? 1));
	child.on("error", () => resolve(1));
});
clearTimeout(timer);

const output = redact(`${stdout}\n${stderr}`);
if (output.includes(key)) {
	console.error("redaction failed; refusing to write the log");
	process.exit(2);
}
writeFileSync(logPath, output);

const events = [];
for (const line of stdout.split("\n")) {
	const trimmed = line.trim();
	if (!trimmed.startsWith("{")) continue;
	try {
		events.push(JSON.parse(trimmed));
	} catch {
		// Partial JSON lines are ignored. The raw log is still redacted on disk.
	}
}

const toolNames = [];
for (const event of events) {
	const message = event.message;
	if (!message || message.role !== "assistant" || !Array.isArray(message.content)) continue;
	for (const part of message.content) {
		if (part.type === "toolCall" || part.type === "tool_use") toolNames.push(part.name);
	}
}

let greet = "";
let testFile = "";
try {
	greet = readFileSync(join(repo, "src", "greet.ts"), "utf8");
} catch {
	greet = "";
}
try {
	testFile = readFileSync(join(repo, "src", "greet.test.ts"), "utf8");
} catch {
	testFile = "";
}

const testRun = await runNodeTest(repo);
const ada = await runAda(repo);
const agents = [];
for (const event of events) {
	const data = event.entry?.data;
	if (event.type === "entry_appended" && data?.type === "assignment.started") agents.push(data.agent);
}
const summary = {
	exitCode,
	model: "kimi-coding/kimi-for-coding",
	thinking: "low",
	toolNames,
	admitted: toolNames.includes("super_eval"),
	agents,
	greetHasHello: greet.includes("Hello,"),
	testFileExists: testFile.length > 0,
	nodeTestStatus: testRun.status,
	adaStatus: ada.status,
	nodeTestTail: redact(testRun.output).slice(-1500),
	logPath,
	repo,
	stderrTail: redact(stderr).slice(-1500),
};
const rendered = JSON.stringify(summary, null, 2);
if (rendered.includes(key)) {
	console.error("redaction failed in the summary");
	process.exit(2);
}
console.log(rendered);
process.exit(exitCode === 0 && summary.greetHasHello && summary.nodeTestStatus === 0 && summary.adaStatus === 0 && agents.includes("worker") ? 0 : 1);

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

function runAda(cwd) {
	return new Promise((resolve) => {
		const test = spawn(
			process.execPath,
			["--experimental-strip-types", "-e", "import { greet } from './src/greet.ts'; if (greet('Ada') !== 'Hello, Ada!') process.exit(1);"],
			{ cwd, stdio: ["ignore", "pipe", "pipe"] },
		);
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

function runNodeTest(cwd) {
	return new Promise((resolve) => {
		const test = spawn(process.execPath, ["--experimental-strip-types", "--test", "src/greet.test.ts"], {
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
