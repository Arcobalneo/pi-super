import type { SuperRules } from "./types.ts";

const READ_ONLY = new Set([
	"cat",
	"head",
	"tail",
	"less",
	"more",
	"grep",
	"rg",
	"find",
	"fd",
	"ls",
	"pwd",
	"wc",
	"sort",
	"uniq",
	"diff",
	"file",
	"stat",
	"du",
	"df",
	"tree",
	"which",
	"whereis",
	"type",
	"uname",
	"whoami",
	"id",
	"date",
	"uptime",
	"ps",
	"env",
	"printenv",
	"jq",
	"bat",
	"git",
	"npm",
	"pnpm",
	"yarn",
	"node",
	"python",
	"python3",
]);

const GIT_READ = new Set(["status", "log", "diff", "show", "branch", "remote", "ls-files", "rev-parse"]);
const NPM_READ = new Set(["list", "ls", "view", "info", "outdated", "audit"]);

/** Ask-first phrases are matched as case-insensitive substrings. The rules file is the source of the phrases. */
export function matchAskFirst(text: string, phrases: readonly string[]): string | undefined {
	const haystack = text.toLowerCase();
	for (const phrase of phrases) {
		const needle = phrase.trim().toLowerCase();
		if (needle && haystack.includes(needle)) return phrase;
	}
	return undefined;
}

export function asksFirst(text: string, rules: SuperRules): string | undefined {
	return matchAskFirst(text, rules.askFirst);
}

/**
 * Plan mode allows inspection only. A compound command is safe when every
 * segment is safe, and redirections or substitutions are never safe.
 */
export function isReadOnlyCommand(command: string): boolean {
	if (/[>]|`|\$\(/.test(command)) return false;
	const segments = command
		.split(/\n|&&|\|\||[;|]/)
		.map((segment) => segment.trim())
		.filter(Boolean);
	if (segments.length === 0) return false;
	return segments.every(isReadOnlySegment);
}

function isReadOnlySegment(segment: string): boolean {
	const stripped = segment.replace(/^\(+/, "").trim();
	const tokens = stripped.split(/\s+/).filter(Boolean);
	const command = tokens[0]?.replace(/^\(+/, "");
	if (!command || !READ_ONLY.has(command)) return false;
	if (command === "git") return GIT_READ.has(tokens[1] ?? "");
	if (command === "npm" || command === "pnpm" || command === "yarn") return NPM_READ.has(tokens[1] ?? "");
	if (command === "node" || command === "python" || command === "python3") {
		return tokens[1] === "--version" || tokens[1] === "-V";
	}
	if (command === "sed") return tokens.includes("-n") && !tokens.includes("-i") && !tokens.some((token) => token.startsWith("-i"));
	return true;
}

const WRITE_TOOLS = new Set(["edit", "write"]);

export function planModeTools(active: readonly string[]): string[] {
	const kept = active.filter((name) => !WRITE_TOOLS.has(name));
	return [...new Set([...kept, "read", "bash", "grep", "find", "ls"])];
}
