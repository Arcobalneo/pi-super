import { basename } from "node:path";

export interface PiCommand {
	command: string;
	args: string[];
}

/**
 * Re-exec the running Pi binary when we can see it. A generic node/bun
 * process falls back to `pi` on PATH. Mirrors the official subagent example.
 */
export function resolvePiCommand(
	env: { execPath: string; argv1?: string; exists: (path: string) => boolean },
	extra: string[],
): PiCommand {
	const script = env.argv1;
	const virtualBun = script?.startsWith("/$bunfs/root/");
	if (script && !virtualBun && env.exists(script)) {
		return { command: env.execPath, args: [script, ...extra] };
	}
	const execName = basename(env.execPath).toLowerCase();
	if (!/^(node|bun)(\.exe)?$/.test(execName)) {
		return { command: env.execPath, args: extra };
	}
	return { command: "pi", args: extra };
}

export function buildSubagentArgs(input: {
	model?: string;
	thinkingLevel?: string;
	tools?: string[];
	systemPromptPath?: string;
	trust: "approve" | "no-approve";
	task: string;
	session?: { dir: string; id: string };
}): string[] {
	const args = [
		"--mode",
		"json",
		"--print",
		...(input.session ? ["--session-dir", input.session.dir, "--session-id", input.session.id] : ["--no-session"]),
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		input.trust === "approve" ? "--approve" : "--no-approve",
	];
	if (input.model) args.push("--model", input.model);
	if (input.thinkingLevel && input.thinkingLevel !== "off") args.push("--thinking", input.thinkingLevel);
	if (input.tools && input.tools.length > 0) args.push("--tools", input.tools.join(","));
	if (input.systemPromptPath) args.push("--append-system-prompt", input.systemPromptPath);
	args.push(input.task);
	return args;
}
