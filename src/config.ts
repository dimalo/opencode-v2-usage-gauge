/**
 * Config for opencode-go-usage, read from the plugin `options` passed in
 * `opencode.json(c)` → `plugins: [{ "package": "opencode-go-usage", "options": {...} }]`.
 *
 * Schema: `{ "layout": "single" | "multi", "showCountdown": boolean }`.
 * Missing or invalid input degrades to the defaults — this module never throws.
 *
 * The options hold NO secrets (the API key stays in OpenCode's auth store).
 */

export type WidgetLayout = "single" | "multi";

export interface GoUsageConfig {
	/** "single" = one compact line; "multi" = title + per-window lines. */
	layout: WidgetLayout;
	/** False hides all reset countdowns (widget and snapshot lines). */
	showCountdown: boolean;
}

export const DEFAULT_CONFIG: GoUsageConfig = {
	layout: "single",
	showCountdown: true,
};

/** Parse a config file payload into a validated config (defaults on any problem). */
export function parseGoUsageConfig(json: unknown): GoUsageConfig {
	if (typeof json !== "object" || json === null || Array.isArray(json)) {
		return { ...DEFAULT_CONFIG };
	}
	const obj = json as Record<string, unknown>;
	const layout: WidgetLayout =
		obj.layout === "single" || obj.layout === "multi" ? obj.layout : DEFAULT_CONFIG.layout;
	const showCountdown =
		typeof obj.showCountdown === "boolean" ? obj.showCountdown : DEFAULT_CONFIG.showCountdown;
	return { layout, showCountdown };
}