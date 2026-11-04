import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentConfig, SubagentResult, UsageStats } from "./types.ts";
import { buildSubagentArgs, resolvePiCommand } from "./pi-command.ts";
import { truncate } from "./text.ts";

export function emptyUsage(): UsageStats {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
}

export function addUsage(left: UsageStats, right: UsageStats): UsageStats {
	return {
		input: left.input + right.input,
		output: left.output + right.output,
		cacheRead: left.cacheRead + right.cacheRead,
		cacheWrite: left.cacheWrite + right.cacheWrite,
		cost: left.cost + right.cost,
		turns: left.turns + right.turns,
	};
}

export interface RunState {
	usage: UsageStats;
	stderr: string;
	texts: string[];
	stopReason?: string;
	errorMessage?: string;
}

export function createRunState(): RunState {
	return { usage: emptyUsage(), stderr: "", texts: [] };
}

export function applyPiJsonLine(state: RunState, line: string): void {
	const trimmed = line.trim();
	if (!trimmed) return;
	let event: unknown;
	try {
		event = JSON.parse(trimmed);
	} catch {
		return;
	}
	if (!event || typeof event !== "object") return;
	const record = event as { type?: string; message?: unknown };
	if (record.type !== "message_end" || !record.message || typeof record.message !== "object") return;
	const message = record.message as {
		role?: string;
		content?: { type?: string; text?: string }[];
		usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } };
		stopReason?: string;
		errorMessage?: string;
	};
	if (message.role !== "assistant") return;
	const text = (message.content ?? [])
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
	if (text.trim()) state.texts.push(text);
	state.usage.turns += 1;
	state.usage.input += message.usage?.input ?? 0;
	state.usage.output += message.usage?.output ?? 0;
	state.usage.cacheRead += message.usage?.cacheRead ?? 0;
	state.usage.cacheWrite += message.usage?.cacheWrite ?? 0;
	state.usage.cost += message.usage?.cost?.total ?? 0;
	if (message.stopReason) state.stopReason = message.stopReason;
	if (message.errorMessage) state.errorMessage = message.errorMessage;
}

export function finalRunText(state: RunState): string {
	for (let index = state.texts.length - 1; index >= 0; index--) {
		const text = state.texts[index]?.trim();
		if (text) return text;
	}
	return "";
}

export interface SpawnedProcess {
	stdout: NodeJS.ReadableStream | null;
	stderr: NodeJS.ReadableStream | null;
	killed: boolean;
	kill(signal?: NodeJS.Signals): boolean;
	on(event: "close", listener: (code: number | null) => void): void;
	on(event: "error", listener: (error: Error) => void): void;
}

export type SpawnFn = (command: string, args: string[], options: { cwd: string }) => SpawnedProcess;

export interface SubagentRequest {
	agent: AgentConfig;
	task: string;
	cwd: string;
	model?: string;
	thinkingLevel?: string;
	trust: "approve" | "no-approve";
	signal?: AbortSignal;
	onProgress?: (text: string) => void;
}

export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length);
	if (items.length === 0) return results;
	let next = 0;
	const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
		while (next < items.length) {
			const index = next;
			next += 1;
			const item = items[index];
			if (item !== undefined) results[index] = await fn(item, index);
		}
	});
	await Promise.all(workers);
	return results;
}

export async function runSubagent(request: SubagentRequest, spawnProcess: SpawnFn = defaultSpawn): Promise<SubagentResult> {
	const inherits = !request.agent.model;
	const args = buildSubagentArgs({
		model: request.agent.model ?? request.model,
		thinkingLevel: inherits ? request.thinkingLevel : undefined,
		tools: request.agent.tools,
		trust: request.trust,
		task: request.task,
	});
	let tmpDir: string | undefined;
	if (request.agent.systemPrompt.trim()) {
		tmpDir = await mkdtemp(join(tmpdir(), "pi-super-"));
		const promptPath = join(tmpDir, "prompt.md");
		await writeFile(promptPath, request.agent.systemPrompt, { encoding: "utf8", mode: 0o600 });
		args.splice(args.length - 1, 0, "--append-system-prompt", promptPath);
	}
	const invocation = resolvePiCommand(
		{ execPath: process.execPath, argv1: process.argv[1], exists: existsSync },
		args,
	);
	const state = createRunState();
	let aborted = false;
	let exitCode = 1;
	try {
		if (request.signal?.aborted) {
			return resultOf(request.agent.name, state, 1, true, "aborted");
		}
		const child = spawnProcess(invocation.command, invocation.args, { cwd: request.cwd });
		exitCode = await new Promise<number>((resolve) => {
			let buffer = "";
			const onAbort = () => {
				aborted = true;
				if (!child.killed) child.kill("SIGTERM");
				setTimeout(() => {
					if (!child.killed) child.kill("SIGKILL");
				}, 5000).unref?.();
			};
			request.signal?.addEventListener("abort", onAbort, { once: true });
			child.stdout?.on("data", (chunk: Buffer | string) => {
				buffer += chunk.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) applyPiJsonLine(state, line);
				const text = finalRunText(state);
				if (text) request.onProgress?.(truncate(text, 400));
			});
			child.stderr?.on("data", (chunk: Buffer | string) => {
				state.stderr = truncate(`${state.stderr}${chunk.toString()}`, 8000);
			});
			child.on("error", (error) => {
				state.errorMessage = error.message;
				resolve(1);
			});
			child.on("close", (code) => {
				if (buffer.trim()) applyPiJsonLine(state, buffer);
				request.signal?.removeEventListener("abort", onAbort);
				resolve(code ?? 0);
			});
		});
		return resultOf(request.agent.name, state, exitCode, aborted, aborted ? "aborted" : state.errorMessage);
	} finally {
		if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
	}
}

function resultOf(agent: string, state: RunState, exitCode: number, aborted: boolean, errorMessage?: string): SubagentResult {
	const text = truncate(finalRunText(state), 50_000);
	return {
		agent,
		exitCode,
		text: text || (aborted ? "" : state.stderr),
		stderr: state.stderr,
		usage: state.usage,
		stopReason: aborted ? "aborted" : state.stopReason,
		errorMessage,
		aborted,
	};
}

function defaultSpawn(command: string, args: string[], options: { cwd: string }): SpawnedProcess {
	return spawn(command, args, { cwd: options.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
}
