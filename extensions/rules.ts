import { createHash } from "node:crypto";
import type { SuperRules, TellMode } from "./types.ts";

export const DEFAULT_RULES: SuperRules = {
	hopLimit: 8,
	stepTimeoutMinutes: 30,
	parallel: 4,
	tell: "needed",
	acceptInferred: true,
	askFirst: [
		"rm -rf",
		"git push --force",
		"git push -f",
		"git reset --hard",
		"drop table",
		"delete data",
		"spend money",
		"external message",
	],
};

const TELLS = new Set<TellMode>(["always", "needed", "never"]);

export function policyVersion(rules: SuperRules): string {
	const body = JSON.stringify({
		hopLimit: rules.hopLimit,
		parallel: rules.parallel,
		tell: rules.tell,
		acceptInferred: rules.acceptInferred,
		askFirst: rules.askFirst,
	});
	return createHash("sha256").update(body).digest("hex").slice(0, 12);
}

export function overlayRules(base: SuperRules, input: unknown): { rules: SuperRules; error?: string } {
	if (input === undefined) return { rules: base };
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return { rules: base, error: "rules.json must be a JSON object" };
	}
	const record = input as Record<string, unknown>;
	const next: SuperRules = { ...base, askFirst: [...base.askFirst] };

	if ("hopLimit" in record) {
		const value = record.hopLimit;
		if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 32) {
			return { rules: base, error: "hopLimit must be an integer from 1 to 32" };
		}
		next.hopLimit = value;
	}
	if ("stepTimeoutMinutes" in record) {
		const value = record.stepTimeoutMinutes;
		if (typeof value !== "number" || !Number.isFinite(value) || value < 0.25 || value > 240) {
			return { rules: base, error: "stepTimeoutMinutes must be a number from 0.25 to 240" };
		}
		next.stepTimeoutMinutes = value;
	}
	if ("parallel" in record) {
		const value = record.parallel;
		if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 8) {
			return { rules: base, error: "parallel must be an integer from 1 to 8" };
		}
		next.parallel = value;
	}
	if ("tell" in record) {
		if (typeof record.tell !== "string" || !TELLS.has(record.tell as TellMode)) {
			return { rules: base, error: 'tell must be "always", "needed", or "never"' };
		}
		next.tell = record.tell as TellMode;
	}
	if ("acceptInferred" in record) {
		if (typeof record.acceptInferred !== "boolean") {
			return { rules: base, error: "acceptInferred must be a boolean" };
		}
		next.acceptInferred = record.acceptInferred;
	}
	if ("askFirst" in record) {
		const phrases = readPhrases(record.askFirst);
		if (!phrases) return { rules: base, error: "askFirst must be an array of 1–80 character strings (max 32)" };
		next.askFirst = phrases;
	}
	return { rules: next };
}

function readPhrases(value: unknown): string[] | undefined {
	if (!Array.isArray(value) || value.length > 32) return undefined;
	const phrases: string[] = [];
	for (const item of value) {
		if (typeof item !== "string") return undefined;
		const trimmed = item.trim();
		if (!trimmed || trimmed.length > 80) return undefined;
		phrases.push(trimmed);
	}
	return phrases;
}

export function readRulesText(text: string | undefined, base: SuperRules): { rules: SuperRules; error?: string } {
	if (text === undefined) return { rules: base };
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { rules: base, error: "rules.json is not valid JSON" };
	}
	return overlayRules(base, parsed);
}

export interface RulesLoad {
	rules: SuperRules;
	error?: string;
}

/** User file first, then the nearest project file. A bad file is ignored and reported. */
export function loadRules(userText: string | undefined, projectText: string | undefined): RulesLoad {
	const user = readRulesText(userText, DEFAULT_RULES);
	const project = readRulesText(projectText, user.rules);
	const errors = [user.error, project.error].filter((error): error is string => Boolean(error));
	return {
		rules: project.rules,
		error: errors.length > 0 ? errors.join("; ") : undefined,
	};
}
