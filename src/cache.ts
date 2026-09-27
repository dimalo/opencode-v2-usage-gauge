/**
 * Cross-process disk cache for the OpenCode Go usage snapshot.
 *
 * Follows OpenCode's own data-dir convention: a small JSON file in the OpenCode
 * data dir that any OpenCode TUI instance can read. The file holds ONLY
 * usage numbers — never the API key, which always stays in OpenCode's auth store.
 *
 * Semantics are deliberately simple (per the design): no file locking, atomic
 * writes (temp file + rename), last-writer-wins, and lenient reads that treat
 * a missing/corrupt/unknown-version file as a cache miss. This lets several
 * OpenCode TUI instances share one fetch within a TTL window and lets data
 * survive restarts.
 */

import type { ParsedUsage, UsageWindowKey, UsageWindowState } from "./parser.ts";
import { WINDOW_KEYS } from "./parser.ts";

export const CACHE_FILE_VERSION = 1;

interface PersistedWindow {
	key: UsageWindowKey;
	label: string;
	usagePercent?: number;
	usageDollars?: number;
	limitDollars: number;
	resetsAtMs?: number;
	resetInSec?: number;
	status?: string;
}

export interface UsageCacheFile {
	version: number;
	fetchedAtMs: number;
	provider: string;
	windows: PersistedWindow[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Serialize a parsed usage snapshot into the JSON string written to disk. */
export function serializeUsageCache(data: ParsedUsage, provider: string): string {
	const file: UsageCacheFile = {
		version: CACHE_FILE_VERSION,
		fetchedAtMs: data.fetchedAtMs,
		provider,
		windows: data.windows.map((w) => ({
			key: w.key,
			label: w.label,
			usagePercent: w.usagePercent,
			usageDollars: w.usageDollars,
			limitDollars: w.limitDollars,
			resetsAtMs: w.resetsAtMs,
			resetInSec: w.resetInSec,
			status: w.status,
		})),
	};
	return JSON.stringify(file, null, 2);
}

/**
 * Leniently read a cache file string back into a ParsedUsage snapshot.
 * Returns undefined for any structural problem (bad JSON, wrong version,
 * no numeric fetchedAtMs, or no usable windows) so the caller can fetch fresh.
 */
export function parseUsageCache(raw: string): ParsedUsage | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!isRecord(parsed)) return undefined;
	if (parsed.version !== CACHE_FILE_VERSION) return undefined;

	const fetchedAtMs = toFiniteNumber(parsed.fetchedAtMs);
	if (fetchedAtMs === undefined) return undefined;
	if (!Array.isArray(parsed.windows)) return undefined;

	const windows: UsageWindowState[] = [];
	for (const item of parsed.windows) {
		if (!isRecord(item)) continue;
		const key = item.key;
		if (typeof key !== "string" || !(WINDOW_KEYS as readonly string[]).includes(key)) continue;
		const limitDollars = toFiniteNumber(item.limitDollars);
		if (limitDollars === undefined) continue;
		const window: UsageWindowState = {
			key: key as UsageWindowKey,
			label: typeof item.label === "string" && item.label.length > 0 ? item.label : (key as string),
			limitDollars,
		};
		const usagePercent = toFiniteNumber(item.usagePercent);
		if (usagePercent !== undefined) window.usagePercent = usagePercent;
		const usageDollars = toFiniteNumber(item.usageDollars);
		if (usageDollars !== undefined) window.usageDollars = usageDollars;
		const resetsAtMs = toFiniteNumber(item.resetsAtMs);
		if (resetsAtMs !== undefined) window.resetsAtMs = resetsAtMs;
		const resetInSec = toFiniteNumber(item.resetInSec);
		if (resetInSec !== undefined) window.resetInSec = resetInSec;
		if (typeof item.status === "string") window.status = item.status;
		windows.push(window);
	}

	if (windows.length === 0) return undefined;
	return { windows, fetchedAtMs, valid: true };
}
