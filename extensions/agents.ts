import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentConfig, AgentScope } from "./types.ts";

export function bundledAgentsDir(): string {
	return join(dirname(fileURLToPath(import.meta.url)), "..", "agents");
}

export function discoverAgents(options: {
	scope: AgentScope;
	bundledDir?: string;
	userDir?: string;
	projectDir?: string | null;
}): AgentConfig[] {
	const bundled = options.bundledDir ? loadAgents(options.bundledDir, "bundled") : [];
	const user = options.userDir ? loadAgents(options.userDir, "user") : [];
	const project = options.projectDir ? loadAgents(options.projectDir, "project") : [];
	const map = new Map<string, AgentConfig>();
	const layers = layersFor(options.scope, bundled, user, project);
	for (const layer of layers) {
		for (const agent of layer) map.set(agent.name, agent);
	}
	return [...map.values()];
}

function layersFor(scope: AgentScope, bundled: AgentConfig[], user: AgentConfig[], project: AgentConfig[]): AgentConfig[][] {
	switch (scope) {
		case "bundled":
			return [bundled];
		case "user":
			return [user];
		case "project":
			return [project];
		case "all":
			return [bundled, user, project];
		default:
			return [bundled, user];
	}
}

export function loadAgents(dir: string, source: AgentConfig["source"]): AgentConfig[] {
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return [];
	}
	const agents: AgentConfig[] = [];
	for (const name of names) {
		if (!name.endsWith(".md")) continue;
		let content: string;
		try {
			content = readFileSync(join(dir, name), "utf8");
		} catch {
			continue;
		}
		const parsed = parseAgentFile(content, join(dir, name), source);
		if (parsed) agents.push(parsed);
	}
	return agents;
}

export function parseAgentFile(content: string, filePath: string, source: AgentConfig["source"]): AgentConfig | undefined {
	const split = splitFrontmatter(content);
	if (!split) return undefined;
	const name = split.data.name?.trim();
	const description = split.data.description?.trim();
	if (!name || !description) return undefined;
	const tools = split.data.tools
		?.split(",")
		.map((tool) => tool.trim())
		.filter(Boolean);
	const model = split.data.model?.trim();
	return {
		name,
		description,
		tools: tools && tools.length > 0 ? tools : undefined,
		model: model || undefined,
		systemPrompt: split.body.trim(),
		source,
		filePath,
	};
}

function splitFrontmatter(content: string): { data: Record<string, string>; body: string } | undefined {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
	if (!match) return undefined;
	const data: Record<string, string> = {};
	for (const line of match[1]?.split(/\r?\n/) ?? []) {
		const separator = line.indexOf(":");
		if (separator <= 0) continue;
		const key = line.slice(0, separator).trim();
		const value = line.slice(separator + 1).trim();
		if (key) data[key] = value;
	}
	return { data, body: match[2] ?? "" };
}
