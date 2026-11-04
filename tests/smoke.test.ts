import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import extension from "../extensions/index.ts";

describe("extension factory", () => {
	it("is a Pi extension factory and registers the superagent surface", async () => {
		const factory: (pi: ExtensionAPI) => void = extension;
		const tools: { name: string; execute: (...args: unknown[]) => Promise<unknown> }[] = [];
		const commands: string[] = [];
		const flags: string[] = [];
		const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
		const entries: unknown[] = [
			{
				type: "custom",
				customType: "pi-super",
				data: {
					type: "ticket.created",
					ticket: {
						id: "t9",
						title: "Restored",
						scope: "From the session log",
						strength: "explicit",
						policyVersion: "v",
						askFirst: [],
						hops: 0,
					},
				},
			},
		];
		const ctx = {
			cwd: "/tmp",
			hasUI: false,
			isProjectTrusted: () => true,
			signal: undefined,
			model: undefined,
			thinkingLevel: undefined,
			ui: {
				notify() {},
				confirm: async () => false,
				select: async () => undefined,
				setStatus() {},
				setWidget() {},
				theme: { fg: (_color: string, text: string) => text },
			},
			sessionManager: {
				getBranch: () => entries,
				getEntries: () => entries,
			},
			isIdle: () => true,
		};
		const api = {
			on(name: string, handler: (event: unknown, ctx: unknown) => unknown) {
				handlers.set(name, handler);
				return () => undefined;
			},
			registerTool(tool: { name: string; execute: (...args: unknown[]) => Promise<unknown> }) {
				tools.push(tool);
			},
			registerCommand(name: string) {
				commands.push(name);
			},
			registerFlag(name: string) {
				flags.push(name);
			},
			registerShortcut() {},
			getFlag() {
				return false;
			},
			getActiveTools() {
				return ["read", "bash", "edit", "write"];
			},
			setActiveTools() {},
			appendEntry(customType: string, data?: unknown) {
				entries.push({ type: "custom", customType, data });
			},
			getSessionName() {
				return undefined;
			},
			setSessionName() {},
			sendUserMessage() {},
		};
		factory(api as unknown as ExtensionAPI);
		expect(tools.map((tool) => tool.name)).toEqual(["super_eval", "super_dispatch", "super_report", "super_status"]);
		expect(commands).toEqual(["super"]);
		expect(flags).toEqual(["super", "super-plan"]);
		expect([...handlers.keys()]).toEqual(
			expect.arrayContaining(["session_start", "session_shutdown", "tool_call", "agent_before_settle", "before_agent_start"]),
		);

		await handlers.get("session_start")?.({}, ctx);
		const status = tools.find((tool) => tool.name === "super_status");
		const statusResult = (await status?.execute("1", {}, undefined, undefined, ctx)) as { content: { text: string }[] };
		expect(statusResult.content[0]?.text).toContain("t9");

		const evalTool = tools.find((tool) => tool.name === "super_eval");
		const accepted = (await evalTool?.execute(
			"2",
			{ title: "Next", scope: "Do the next thing", strength: "explicit", decision: "accept", reason: "user asked" },
			undefined,
			undefined,
			ctx,
		)) as { content: { text: string }[] };
		expect(accepted.content[0]?.text).toContain("Accepted t10");

		const filtered = (await handlers.get("context")?.(
			{ messages: [{ customType: "pi-super-context", role: "custom" }, { role: "user" }] },
			ctx,
		)) as { messages: { role?: string }[] };
		expect(filtered.messages).toEqual([{ role: "user" }]);
	});
});
