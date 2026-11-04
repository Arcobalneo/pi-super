import { existsSync, statSync } from "node:fs";
import { dirname, join, parse } from "node:path";

function isDir(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

/**
 * Walk from `start` toward the filesystem root, including `start`.
 * Stop after the directory that contains `.git`, so a checkout does not
 * inherit a parent repository's Pi config.
 */
export function findUp(start: string, parts: string[], kind: "file" | "dir"): string | undefined {
	let dir = start;
	while (true) {
		const candidate = join(dir, ...parts);
		if (kind === "file" ? isFile(candidate) : isDir(candidate)) return candidate;
		if (existsSync(join(dir, ".git"))) return undefined;
		const parent = dirname(dir);
		if (parent === dir || parse(dir).root === dir) return undefined;
		dir = parent;
	}
}
