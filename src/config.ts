/**
 * Config for the plugin, read from the plugin `options` passed in
 * `~/.config/opencode/cli.json` → `plugins: [{ "package": …, "options": {…} }]`.
 *
 * Schema:
 *   `{ layout, showCountdown, placement, maxWidth, providers }`
 * Missing or invalid input degrades to the defaults — this module never throws.
 *
 * The options hold NO secrets (credentials stay in OpenCode's auth store).
 */

import { ADAPTER_IDS } from "./registry.ts";

export type WidgetLayout = "single" | "multi";

export type Placement = "promptFooter" | "sidebar" | "both";

export interface GaugeConfig {
	/** "single" = one compact line; "multi" = title + per-window lines. */
	layout: WidgetLayout;
	/** False hides all reset countdowns (widget and snapshot lines). */
	showCountdown: boolean;
	/** Where the widget renders: prompt footer, session sidebar, or both. */
	placement: Placement;
	/**
	 * Cell budget for the single-line widget. 0 (default) = auto (at most half
	 * the row, min 48). A positive value is clamped to the terminal width. The
	 * prompt footer is shared with the built-in items, so an unbounded line
	 * wraps and loses labels.
	 */
	maxWidth: number;
	/**
	 * Which providers the gauge tracks: adapter ids (e.g. "opencode-go") or
	 * "all". The widget follows the selected model, so this is a filter on top
	 * of "provider has an adapter". Unknown ids are dropped; an empty list
	 * falls back to every registered adapter.
	 */
	providers: string[];
}

export const DEFAULT_CONFIG: GaugeConfig = {
	layout: "single",
	showCountdown: true,
	placement: "promptFooter",
	maxWidth: 0,
	providers: ["opencode-go"],
};

const PLACEMENTS: readonly string[] = ["promptFooter", "sidebar", "both"];

/** Parse a config payload into a validated config (defaults on any problem). */
export function parseConfig(json: unknown): GaugeConfig {
	if (typeof json !== "object" || json === null || Array.isArray(json)) {
		return { ...DEFAULT_CONFIG, providers: [...DEFAULT_CONFIG.providers] };
	}
	const obj = json as Record<string, unknown>;
	const layout: WidgetLayout =
		obj.layout === "single" || obj.layout === "multi" ? obj.layout : DEFAULT_CONFIG.layout;
	const showCountdown =
		typeof obj.showCountdown === "boolean" ? obj.showCountdown : DEFAULT_CONFIG.showCountdown;
	const placement =
		typeof obj.placement === "string" && PLACEMENTS.includes(obj.placement)
			? (obj.placement as Placement)
			: DEFAULT_CONFIG.placement;
	const maxWidth =
		typeof obj.maxWidth === "number" && Number.isFinite(obj.maxWidth) && obj.maxWidth > 0
			? Math.floor(obj.maxWidth)
			: DEFAULT_CONFIG.maxWidth;
	return { layout, showCountdown, placement, maxWidth, providers: parseProviders(obj.providers) };
}

/**
 * Accepts a single id, a list of ids, or "all". Non-strings and unknown ids
 * are dropped rather than rejected — a typo must never leave the user with no
 * gauge. "all" always wins, since it is the explicit "everything" request.
 */
function parseProviders(raw: unknown): string[] {
	if (raw === "all") return ["all"];
	const list = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
	if (list.includes("all")) return ["all"];
	const known = list.filter(
		(entry): entry is string => typeof entry === "string" && ADAPTER_IDS.includes(entry),
	);
	const unique = [...new Set(known)];
	return unique.length > 0 ? unique : [...DEFAULT_CONFIG.providers];
}
