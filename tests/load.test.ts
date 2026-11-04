import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pi = join(root, "node_modules", ".bin", "pi");

describe("pi CLI load", () => {
	it("loads the extension with the current pi binary and exposes its flags", () => {
		expect(existsSync(pi), "install @earendil-works/pi-coding-agent to run the load check").toBe(true);
		const result = spawnSync(pi, ["--no-extensions", "-e", join(root, "extensions", "index.ts"), "--help"], {
			cwd: root,
			encoding: "utf8",
			timeout: 60_000,
		});
		const output = `${result.stdout}\n${result.stderr}`;
		expect(result.status, output).toBe(0);
		expect(output).toContain("--super");
		expect(output).toContain("--super-plan");
	});
});
