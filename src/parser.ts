/**
 * Lenient parser for the OpenCode Go usage endpoint.
 *
 * Endpoint: `GET https://opencode.ai/zen/go/v1/usage` (Bearer auth)
 * The upstream response shape is not formally pinned (PR anomalyco/opencode#16513).
 * Field names observed in the wild / in discussion:
 *   - window containers: `{"usage": {rolling|weekly|monthly}}`, `{"windows": {...}}`,
 *     or windows directly at the top level (`rolling5h`, `weekly`, `monthly`)
 *   - per-window fields: `usagePercent` | `percent` | `usage_percent`,
 *     `resetsAt` (ISO or epoch ms) | `resetInSec` | `reset_in_sec`,
 *     `usageDollars` | `limitDollars`, `status` ("ok", ...)
 *
 * This module is intentionally dependency-free and side-effect free so it can be
 * unit-tested directly under `node --test`.
 */

export type UsageWindowKey = "rolling" | "weekly" | "monthly";

export interface UsageWindowState {
	/** Semantic window id. */
	key: UsageWindowKey;
	/** Short display label ("5h", "week", "month"). */
	label: string;
	/** Usage as a percentage (0–100+). Undefined when the API omitted it entirely. */
	usagePercent?: number;
	/** Dollar amount used in this window, when reported. */
	usageDollars?: number;
	/** Dollar limit for this window. Falls back to the documented Go plan limits. */
	limitDollars: number;
	/** Absolute epoch ms at which the window resets, when derivable. */
	resetsAtMs?: number;
	/** Seconds until reset, when reported (or derived from resetsAtMs). */
	resetInSec?: number;
	/** Raw status string from the API (e.g. "ok"), if present. */
	status?: string;
}

export interface ParsedUsage {
	/** The three windows in fixed order; missing windows are simply absent. */
	windows: UsageWindowState[];
	/** Epoch ms of the fetch that produced this data. */
	fetchedAtMs: number;
	/** False when the payload contained no recognizable Go usage window at all. */
	valid: boolean;
}

/** Documented OpenCode Go plan limits (USD), used when the API omits limitDollars. */
export const DEFAULT_LIMIT_DOLLARS: Record<UsageWindowKey, number> = {
	rolling: 12,
	weekly: 30,
	monthly: 60,
};

export const WINDOW_LABELS: Record<UsageWindowKey, string> = {
	rolling: "5h",
	weekly: "week",
	monthly: "month",
};

/** Ordered window keys as rendered. */
export const WINDOW_KEYS: readonly UsageWindowKey[] = ["rolling", "weekly", "monthly"];

/** Aliases per window under which the API may key the window object. */
const WINDOW_ALIASES: Record<UsageWindowKey, readonly string[]> = {
	rolling: ["rolling", "rolling5h", "rolling_5h", "5h"],
	weekly: ["weekly", "week", "weekly_usage"],
	monthly: ["monthly", "month", "monthly_usage"],
};

const PERCENT_ALIASES = ["usagePercent", "usage_percent", "usagePct", "percent", "percentage"] as const;
const USAGE_DOLLARS_ALIASES = ["usageDollars", "usage_dollars", "usedDollars", "used"] as const;
const LIMIT_DOLLARS_ALIASES = ["limitDollars", "limit_dollars", "limit", "quotaDollars"] as const;
const RESETS_AT_ALIASES = ["resetsAt", "resets_at", "resetAt", "reset_at", "resetsAtIso", "resetTimestamp"] as const;
const RESET_IN_SEC_ALIASES = [
	"resetInSec",
	"reset_in_sec",
	"resetsInSec",
	"resets_in_sec",
	"resetInSeconds",
	"resetsInSeconds",
	"resets_in_seconds",
	"resetIn",
] as const;
const STATUS_ALIASES = ["status", "state"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Accept numbers and numeric strings; reject anything else. */
function toFiniteNumber(value: unknown): number | undefined {
	if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
	if (typeof value === "string" && value.trim() !== "") {
		const n = Number(value.trim());
		return Number.isFinite(n) ? n : undefined;
	}
	return undefined;
}

/** First present value among aliases (returns the object/string/number as-is). */
function pick(obj: Record<string, unknown>, aliases: readonly string[]): unknown {
	for (const alias of aliases) {
		const value = obj[alias];
		if (value !== undefined && value !== null) return value;
	}
	return undefined;
}

/** Candidates containers that may hold the window objects. */
function containerCandidates(root: unknown): ReadonlyArray<Record<string, unknown> | undefined> {
	if (!isRecord(root)) return [];
	const nested: Array<Record<string, unknown> | undefined> = [];
	for (const key of ["usage", "windows", "windows_usage", "data"]) {
		const value = root[key];
		if (isRecord(value)) nested.push(value);
	}
	return [root, ...nested];
}

/** Find the first window object matching any of the given aliases, in any candidate container. */
function findWindowObject(root: unknown, aliases: readonly string[]): unknown | undefined {
	for (const container of containerCandidates(root)) {
		if (!container) continue;
		for (const alias of aliases) {
			const value = container[alias];
			if (isRecord(value)) return value;
		}
	}
	return undefined;
}

function parseWindow(key: UsageWindowKey, raw: unknown, nowMs: number): UsageWindowState | undefined {
	if (!isRecord(raw)) return undefined;

	const usagePercent = toFiniteNumber(pick(raw, PERCENT_ALIASES));
	const usageDollars = toFiniteNumber(pick(raw, USAGE_DOLLARS_ALIASES));
	const limitDollars =
		toFiniteNumber(pick(raw, LIMIT_DOLLARS_ALIASES)) ?? DEFAULT_LIMIT_DOLLARS[key];

	// Derive a percent when only dollar amounts were reported.
	let effectivePercent = usagePercent;
	if (effectivePercent === undefined && usageDollars !== undefined && limitDollars > 0) {
		effectivePercent = (usageDollars / limitDollars) * 100;
	}

	const resetsAtRaw = pick(raw, RESETS_AT_ALIASES);
	let resetsAtMs: number | undefined;
	if (typeof resetsAtRaw === "string") {
		const t = Date.parse(resetsAtRaw);
		if (Number.isFinite(t)) resetsAtMs = t;
	} else {
		const n = toFiniteNumber(resetsAtRaw);
		// Epoch seconds are ~1.7e9 (10 digits); epoch milliseconds are ~1.7e12 (13 digits).
		if (n !== undefined) resetsAtMs = n < 1e11 ? n * 1000 : n;
	}

	let resetInSec = toFiniteNumber(pick(raw, RESET_IN_SEC_ALIASES));
	if (resetsAtMs === undefined && resetInSec !== undefined) {
		resetsAtMs = nowMs + resetInSec * 1000;
	} else if (resetInSec === undefined && resetsAtMs !== undefined) {
		resetInSec = Math.max(0, Math.round((resetsAtMs - nowMs) / 1000));
	}

	const statusRaw = pick(raw, STATUS_ALIASES);
	const status = typeof statusRaw === "string" ? statusRaw : undefined;

	const hasAnything =
		usagePercent !== undefined ||
		usageDollars !== undefined ||
		resetsAtMs !== undefined ||
		status !== undefined;
	if (!hasAnything) return undefined;

	return {
		key,
		label: WINDOW_LABELS[key],
		usagePercent: effectivePercent,
		usageDollars,
		limitDollars,
		resetsAtMs,
		resetInSec,
		status,
	};
}

/**
 * Parse a usage endpoint JSON payload into a structured, defensive result.
 *
 * Missing/renamed fields degrade gracefully: windows that cannot be recognized
 * are omitted, and per-window fields that are absent simply stay undefined.
 */
export function parseUsageResponse(json: unknown, nowMs: number = Date.now()): ParsedUsage {
	const windows: UsageWindowState[] = [];
	for (const key of WINDOW_KEYS) {
		const raw = findWindowObject(json, WINDOW_ALIASES[key]);
		if (raw === undefined) continue;
		const parsed = parseWindow(key, raw, nowMs);
		if (parsed) windows.push(parsed);
	}
	return {
		windows,
		fetchedAtMs: nowMs,
		valid: windows.length > 0,
	};
}

/**
 * Render a milliseconds-since-epoch reset moment as a compact countdown at
 * minute granularity (ceil'ed, so 45s already shows "1m"):
 *  - < 1h:  "Nm"
 *  - < 1d:  "Hh Mm"
 *  - >= 1d: "Nd Hh"
 */
export function formatResetDuration(resetsAtMs: number, nowMs: number): string {
	const totalMinutes = Math.max(0, Math.ceil((resetsAtMs - nowMs) / 60_000));
	const days = Math.floor(totalMinutes / 1440);
	const hours = Math.floor((totalMinutes % 1440) / 60);
	const minutes = totalMinutes % 60;
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

/** Compact no-space variant of formatResetDuration: "2h 13m" → "2h13m". */
export function formatResetDurationCompact(resetsAtMs: number, nowMs: number): string {
	return formatResetDuration(resetsAtMs, nowMs).replace(/ /gu, "");
}

/** Compact dollar display, e.g. `$2.34` / `$12` (trailing .00 trimmed). */
export function formatDollars(value: number): string {
	const fixed = value.toFixed(2);
	return `$${fixed.endsWith(".00") ? fixed.slice(0, -3) : fixed}`;
}

/** Percentage display, e.g. `19%` (keeps the raw value; may exceed 100). */
export function formatPercent(value: number): string {
	const rounded = Math.round(value);
	return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}