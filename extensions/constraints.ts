/** Human constraints captured at intake and checked by the kernel before a ticket may be ready. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";
import type { Baseline, Constraints, Ticket } from "./types.ts";

const ASK_FIRST = [/问我/, /问一下我/, /先问/, /\bask me\b/i, /\bask first\b/i, /check with me/i];
const NO_DEPS = [/不要?(加|添加|引入|新增)(任何)?(新的?)?依赖/, /不加依赖/, /\bno (new )?dependenc/i, /do not add (any )?(new )?dependenc/i, /don't add (any )?(new )?dependenc/i];
const NO_COMMIT = [/不要\s*commit/i, /不要提交/, /别\s*commit/i, /\bdo not commit\b/i, /\bdon't commit\b/i, /\bno commit\b/i];

/** Read constraints the person stated in plain words. The Router may add more. */
export function detectConstraints(text: string): Constraints {
	const found: Constraints = {};
	if (ASK_FIRST.some((re) => re.test(text))) found.askFirst = true;
	if (NO_DEPS.some((re) => re.test(text))) found.noNewDeps = true;
	if (NO_COMMIT.some((re) => re.test(text))) found.noCommit = true;
	return found;
}

export function mergeConstraints(...items: (Constraints | undefined)[]): Constraints {
	const out: Constraints = {};
	const files = new Set<string>();
	for (const item of items) {
		if (!item) continue;
		if (item.askFirst) out.askFirst = true;
		if (item.noNewDeps) out.noNewDeps = true;
		if (item.noCommit) out.noCommit = true;
		for (const file of item.files ?? []) if (file.trim()) files.add(file.trim().replace(/^\.\//, ""));
	}
	if (files.size > 0) out.files = [...files];
	return out;
}

export function hasConstraints(c: Constraints | undefined): boolean {
	return Boolean(c && (c.askFirst || c.noNewDeps || c.noCommit || (c.files?.length ?? 0) > 0));
}

export function describeConstraints(c: Constraints | undefined, answered = false): string[] {
	if (!c) return [];
	const lines: string[] = [];
	if (c.askFirst) {
		lines.push(
			answered
				? "Ask first: done. The person already answered (see Answers already given). Implement that answer now. Do not ask again or ask permission to edit."
				: "Ask first: the person's answer is required before any edit. Do not decide it yourself.",
		);
	}
	if (c.noNewDeps) lines.push("No new dependencies: do not add package.json dependencies or devDependencies, or create a package.json with any.");
	if (c.noCommit) lines.push("No commit: leave HEAD where it is.");
	for (const file of c.files ?? []) lines.push(`Required file: ${file} (exact path).`);
	return lines;
}


function git(cwd: string, args: string[]): string | undefined {
	try {
		return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
	} catch {
		return undefined;
	}
}

function depNames(text: string | undefined): string[] {
	if (!text) return [];
	try {
		const pkg = JSON.parse(text) as Record<string, Record<string, string> | undefined>;
		return [
			...Object.keys(pkg.dependencies ?? {}),
			...Object.keys(pkg.devDependencies ?? {}),
			...Object.keys(pkg.optionalDependencies ?? {}),
			...Object.keys(pkg.peerDependencies ?? {}),
		];
	} catch {
		return [];
	}
}

function readIf(path: string): string | undefined {
	try {
		return existsSync(path) ? readFileSync(path, "utf8") : undefined;
	} catch {
		return undefined;
	}
}

/** Snapshot of the tree at intake. Undefined outside a git work tree. */
export function captureBaseline(cwd: string | undefined): Baseline | undefined {
	if (!cwd) return undefined;
	if (git(cwd, ["rev-parse", "--is-inside-work-tree"])?.trim() !== "true") return undefined;
	return {
		head: git(cwd, ["rev-parse", "HEAD"])?.trim() || undefined,
		status: fingerprint(cwd),
		deps: depNames(readIf(join(cwd, "package.json"))),
	};
}

/** Every reason the ticket may not be ready. Empty means the constraints hold. */
export function constraintViolations(cwd: string, ticket: Ticket): string[] {
	const c = ticket.constraints;
	const base = ticket.baseline;
	const out: string[] = [];
	if (c?.askFirst && ticket.answers.length === 0) {
		out.push("Ask first was required, but the person was never asked. Emit an ask receipt instead of deciding.");
	}
	for (const file of c?.files ?? []) {
		if (!existsSync(join(cwd, file))) out.push(`Required file ${file} does not exist.`);
	}
	if (c?.noNewDeps) {
		const before = new Set(base?.deps ?? []);
		const added = depNames(readIf(join(cwd, "package.json"))).filter((name) => !before.has(name));
		if (added.length > 0) out.push(`New dependencies were added against the mandate: ${added.join(", ")}.`);
		const declared = new Set([...(base?.deps ?? []), ...depNames(readIf(join(cwd, "package.json")))]);
		const undeclared = new Set<string>();
		for (const file of changedFiles(cwd)) {
			if (!/\.(c|m)?(t|j)sx?$/.test(file)) continue;
			for (const name of bareImports(readIf(join(cwd, file)) ?? "")) if (!declared.has(name)) undeclared.add(`${name} (${file})`);
		}
		if (undeclared.size > 0) {
			out.push(`Code imports packages that are not installed or declared, against "no new dependencies": ${[...undeclared].join(", ")}. Use node built-ins such as node:test.`);
		}
	}
	if (base) {
		const head = git(cwd, ["rev-parse", "HEAD"])?.trim() || undefined;
		if (c?.noCommit && head !== base.head) out.push("A commit was made against the mandate.");
		if (ticket.lane === "code") {
			const changed = fingerprint(cwd) !== base.status || head !== base.head;
			if (!changed) out.push("No change in the tree since the ticket started.");
		}
	}
	return out;
}

/** Hash of tracked changes plus untracked file contents, so edits to an already-dirty file count. */
export function fingerprint(cwd: string): string {
	const hash = createHash("sha256");
	hash.update(git(cwd, ["diff", "HEAD", "--binary"]) ?? git(cwd, ["diff", "--binary"]) ?? "");
	const untracked = (git(cwd, ["ls-files", "--others", "--exclude-standard"]) ?? "").split("\n").filter(Boolean).sort();
	for (const file of untracked) {
		hash.update(`\0${file}\0`);
		hash.update(readIf(join(cwd, file)) ?? "");
	}
	return hash.digest("hex");
}

const BUILTIN = new Set(builtinModules);

/** Package names imported with bare specifiers, excluding node built-ins and relative paths. */
export function bareImports(text: string): string[] {
	const names = new Set<string>();
	const re = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g;
	for (const match of text.matchAll(re)) {
		const spec = match[1] ?? match[2] ?? match[3] ?? match[4];
		if (!spec || spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) continue;
		const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!;
		if (BUILTIN.has(name)) continue;
		names.add(name);
	}
	return [...names];
}

function changedFiles(cwd: string): string[] {
	const tracked = (git(cwd, ["diff", "HEAD", "--name-only"]) ?? "").split("\n");
	const untracked = (git(cwd, ["ls-files", "--others", "--exclude-standard"]) ?? "").split("\n");
	return [...new Set([...tracked, ...untracked].filter(Boolean))];
}
