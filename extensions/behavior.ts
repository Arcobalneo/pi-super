/**
 * Concrete input→output examples from a mandate, and a check that runs them.
 * A quoted string sitting somewhere in the tree is not a result.
 */

import { spawn } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export type ExampleValue = string | number | boolean | null;

export interface BehaviorExample {
	fn: string;
	args: ExampleValue[];
	expected: ExampleValue;
}

const LITERAL = String.raw`(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?\d+(?:\.\d+)?|true|false|null)`;

/** Calls such as `formatCents(199) === "$1.99"` and examples such as `199 → "$1.99"`. */
export function parseBehaviorExamples(scope: string): BehaviorExample[] {
	const examples: BehaviorExample[] = [];
	const seen = new Set<string>();
	const add = (example: BehaviorExample) => {
		const key = JSON.stringify(example);
		if (seen.has(key)) return;
		seen.add(key);
		examples.push(example);
	};

	const call = new RegExp(
		String.raw`\b([A-Za-z_]\w*)\s*\(\s*([^)]*?)\s*\)\s*(?:===|==|must\s+be|is)\s*(${LITERAL})`,
		"gi",
	);
	for (const match of scope.matchAll(call)) {
		const args = parseArgList(match[2] ?? "");
		const expected = parseLiteral(match[3] ?? "");
		if (!args || expected === undefined) continue;
		add({ fn: match[1] ?? "", args, expected });
	}

	for (const group of functionGroups(scope)) {
		const arrow = new RegExp(String.raw`(${LITERAL})\s*(?:→|->)\s*(${LITERAL})`, "g");
		for (const match of group.body.matchAll(arrow)) {
			const input = parseLiteral(match[1] ?? "");
			const expected = parseLiteral(match[2] ?? "");
			if (input === undefined || expected === undefined) continue;
			add({ fn: group.name, args: [input], expected });
		}
	}
	return examples;
}

export function callLabel(example: BehaviorExample): string {
	return `${example.fn}(${example.args.map((arg) => JSON.stringify(arg)).join(", ")})`;
}

export interface BehaviorMismatch {
	label: string;
	actual?: unknown;
	expected?: unknown;
	error?: string;
}

export function describeMismatch(item: BehaviorMismatch): string {
	if (item.error) {
		const detail = /^(but |could not )/.test(item.error) ? item.error : `threw ${item.error}`;
		return `Behavior mismatch: ${item.label} ${detail}.`;
	}
	return `Behavior mismatch: ${item.label} returned ${JSON.stringify(item.actual)}, expected ${JSON.stringify(item.expected)}.`;
}

/** Run the examples in `cwd`. A string that merely appears in a file is not consulted. */
export async function runBehaviorExamples(cwd: string, examples: BehaviorExample[]): Promise<BehaviorMismatch[]> {
	if (examples.length === 0) return [];
	const located = new Map<string, string>();
	const missing: BehaviorMismatch[] = [];
	for (const example of examples) {
		if (located.has(example.fn)) continue;
		const file = findFunctionFile(cwd, example.fn);
		if (!file) {
			missing.push({
				label: callLabel(example),
				error: `but ${example.fn} is not defined in the tree; expected ${JSON.stringify(example.expected)}`,
			});
			continue;
		}
		located.set(example.fn, file);
	}
	const runnable = examples.filter((example) => located.has(example.fn));
	const ran = runnable.length > 0 ? await executeExamples(cwd, runnable, located) : [];
	return [...missing, ...ran];
}

export function behaviorSummary(mismatches: BehaviorMismatch[]): string {
	const lines = mismatches.map(describeMismatch);
	return `${lines.join(" ")} Change the function so the call returns the expected value. A quoted string elsewhere in the file is not a fix.`;
}

function functionGroups(scope: string): { name: string; body: string }[] {
	const groups: { name: string; body: string }[] = [];
	const re = /\b([A-Za-z_]\w*)\s*\(/g;
	for (const match of scope.matchAll(re)) {
		const name = match[1];
		if (!name || name === "if" || name === "for" || name === "while") continue;
		const open = (match.index ?? 0) + match[0].length;
		const body = readParen(scope, open);
		if (!body || !/(?:→|->)/.test(body)) continue;
		groups.push({ name, body });
	}
	return groups;
}

function readParen(text: string, start: number): string | undefined {
	let depth = 1;
	for (let index = start; index < text.length; index++) {
		const char = text[index];
		if (char === "(") depth += 1;
		else if (char === ")") {
			depth -= 1;
			if (depth === 0) return text.slice(start, index);
		}
	}
	return undefined;
}

function parseArgList(source: string): ExampleValue[] | undefined {
	const trimmed = source.trim();
	if (!trimmed) return [];
	const parts: string[] = [];
	let current = "";
	let quote: '"' | "'" | undefined;
	for (const char of trimmed) {
		if (quote) {
			current += char;
			if (char === quote && !current.endsWith(`\\${quote}`)) quote = undefined;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			current += char;
			continue;
		}
		if (char === ",") {
			parts.push(current.trim());
			current = "";
			continue;
		}
		current += char;
	}
	if (quote) return undefined;
	if (current.trim()) parts.push(current.trim());
	const args: ExampleValue[] = [];
	for (const part of parts) {
		const value = parseLiteral(part);
		if (value === undefined) return undefined;
		args.push(value);
	}
	return args;
}

function parseLiteral(source: string): ExampleValue | undefined {
	const text = source.trim();
	if (text === "true") return true;
	if (text === "false") return false;
	if (text === "null") return null;
	if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
	if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
		try {
			return JSON.parse(text.startsWith("'") ? `"${text.slice(1, -1).replace(/"/g, '\\"')}"` : text) as string;
		} catch {
			return text.slice(1, -1);
		}
	}
	return undefined;
}

function findFunctionFile(cwd: string, name: string): string | undefined {
	const decl = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(|(?:export\\s+)?(?:const|let)\\s+${name}\\s*=`);
	const skip = new Set([".git", "node_modules", "dist", "coverage"]);
	const found: string[] = [];
	const walk = (dir: string, depth: number) => {
		if (depth > 6 || found.length > 0) return;
		let names: string[] = [];
		try {
			names = readdirSync(dir);
		} catch {
			return;
		}
		for (const entry of names) {
			if (skip.has(entry) || entry.startsWith(".pi-super-behavior-check")) continue;
			const path = join(dir, entry);
			let info: ReturnType<typeof statSync>;
			try {
				info = statSync(path);
			} catch {
				continue;
			}
			if (info.isDirectory()) {
				walk(path, depth + 1);
				continue;
			}
			if (!info.isFile() || !/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry) || info.size > 200_000) continue;
			try {
				if (decl.test(readFileSync(path, "utf8"))) found.push(path);
			} catch {
				// Unreadable files are not definitions.
			}
		}
	};
	walk(cwd, 0);
	return found[0];
}

async function executeExamples(
	cwd: string,
	examples: BehaviorExample[],
	files: Map<string, string>,
): Promise<BehaviorMismatch[]> {
	const byFile = new Map<string, string[]>();
	for (const [fn, file] of files) {
		const list = byFile.get(file) ?? [];
		list.push(fn);
		byFile.set(file, list);
	}
	const imports = [...byFile.entries()].map(([file, names], index) => {
		const spec = pathToFileURL(file).href;
		return `import { ${names.join(", ")} } from ${JSON.stringify(spec)};`;
	});
	const cases = examples
		.map((example) => {
			const label = callLabel(example);
			return `[${JSON.stringify(label)}, () => ${label}, ${JSON.stringify(example.expected)}]`;
		})
		.join(",\n");
	const source = `${imports.join("\n")}
const cases = [
${cases}
];
const bad = [];
for (const [label, run, expected] of cases) {
  try {
    const actual = await run();
    if (!Object.is(actual, expected)) bad.push({ label, actual, expected });
  } catch (error) {
    bad.push({ label, error: error instanceof Error ? error.message : String(error) });
  }
}
if (bad.length) {
  process.stdout.write(JSON.stringify(bad));
  process.exit(1);
}
`;
	const dir = await mkdtemp(join(tmpdir(), "pi-super-behavior-"));
	const script = join(dir, "check.mjs");
	await writeFile(script, source, "utf8");
	try {
		const output = await runNode(script, cwd);
		if (output.status === 0) return [];
		const parsed = parseMismatchJson(output.stdout);
		if (parsed) return parsed;
		const detail = (output.stderr || output.stdout || "the check failed").trim().split("\n")[0] ?? "the check failed";
		return examples.map((example) => ({ label: callLabel(example), error: `could not be run: ${detail}` }));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function parseMismatchJson(stdout: string): BehaviorMismatch[] | undefined {
	const trimmed = stdout.trim();
	if (!trimmed.startsWith("[")) return undefined;
	try {
		const value = JSON.parse(trimmed) as BehaviorMismatch[];
		if (!Array.isArray(value)) return undefined;
		return value;
	} catch {
		return undefined;
	}
}

function runNode(script: string, cwd: string): Promise<{ status: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, ["--experimental-strip-types", script], {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
		child.stdout.on("data", (chunk: Buffer | string) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer | string) => {
			stderr += chunk.toString();
		});
		child.on("close", (status) => {
			clearTimeout(timer);
			resolve({ status: status ?? 1, stdout, stderr });
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			resolve({ status: 1, stdout, stderr: error.message });
		});
	});
}
