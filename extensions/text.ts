/** Small string helpers shared by the ledger and the worker protocol. */

export function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max)}\n…[${text.length - max} characters omitted]`;
}

export function firstLine(text: string): string {
	const line = text
		.split(/\r?\n/)
		.map((part) => part.trim())
		.find(Boolean);
	return line ?? "(no output)";
}

export function slug(text: string): string {
	const cleaned = text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);
	return cleaned || "ask";
}

export function clampText(text: string, max: number): string {
	const trimmed = text.trim();
	return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}
