/**
 * Grounding for a ready receipt, independent of the task.
 * The receipt names the commands that prove the deliverable and the files it produced;
 * the kernel replays the commands and looks at the files. Prose is never proof.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Lane } from "./types.ts";

const CHECK_TIMEOUT_MS = 120_000;

export interface VerifyInput {
	cwd: string;
	lane: Lane;
	checks: string[];
	changed: string[];
	request: string;
	run?: (command: string, cwd: string) => Promise<{ code: number; output: string }>;
}

export function runCheck(command: string, cwd: string): Promise<{ code: number; output: string }> {
	return new Promise((resolve) => {
		execFile("sh", ["-c", command], { cwd, timeout: CHECK_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
			const output = `${stdout ?? ""}${stderr ?? ""}`.trim();
			const code = error ? (typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code) : 1) : 0;
			resolve({ code, output });
		});
	});
}

function git(cwd: string, args: string[]): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile("git", args, { cwd }, (error, stdout) => resolve(error ? undefined : stdout));
	});
}

/** Every reason the ready receipt is not grounded. Empty means it holds. */
export async function verifyReady(input: VerifyInput): Promise<string[]> {
	const out: string[] = [];
	const produces = input.lane === "code" || input.lane === "task";
	if (produces && input.checks.length === 0) {
		out.push(
			"The ready receipt lists no checks. Add checks: commands the kernel can rerun that prove the deliverable meets the original request (tests, a script, or `grep`/`test` on the produced file).",
		);
	}
	if (produces && input.changed.length === 0) {
		out.push("The ready receipt lists no changed files. Name every file created or changed in changed, or report dropped if nothing was needed.");
	}
	const inGit = (await git(input.cwd, ["rev-parse", "--is-inside-work-tree"]))?.trim() === "true";
	const status = inGit ? (await git(input.cwd, ["status", "--porcelain", "--untracked-files=all"])) ?? "" : "";
	for (const file of input.changed) {
		const clean = file.replace(/^\.\//, "");
		const listed = status.split("\n").some((line) => line.slice(3).trim() === clean || line.slice(3).trim().startsWith(`${clean}/`) || line.includes(` -> ${clean}`));
		if (!existsSync(join(input.cwd, clean)) && !listed) out.push(`Listed file ${clean} does not exist.`);
		else if (inGit && !listed) {
			const head = await git(input.cwd, ["log", "-1", "--format=%H", "--", clean]);
			if (!head?.trim()) out.push(`Listed file ${clean} has no change in the tree.`);
		}
	}
	const run = input.run ?? runCheck;
	for (const command of input.checks) {
		const result = await run(command, input.cwd);
		if (result.code !== 0) {
			out.push(`Check \`${command}\` exited ${result.code}: ${result.output.slice(-400) || "(no output)"}`);
		}
	}
	return out;
}
