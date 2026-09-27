/**
 * Fetch + apply logic for the OpenCode Go usage endpoint, shared by the TUI
 * widget and the /usage slash command. Mirrors the pi extension's behavior:
 * single-flight fetches, ~5 min cache TTL, stale-data fallback on transient
 * failures, and silent degradation (never crash, never leak the key).
 */

import type { ParsedUsage } from "./parser.ts";
import { parseUsageResponse } from "./parser.ts";
import { readApiKeyFromAuthStore } from "./auth.ts";

export const USAGE_ENDPOINT = "https://opencode.ai/zen/go/v1/usage";
/** Provider that gates widget visibility; also the provider /usage always queries. */
export const TARGET_PROVIDER = "opencode-go";
/** Re-fetch the widget at most every 5 minutes (the /usage command always fetches fresh). */
export const CACHE_TTL_MS = 5 * 60 * 1000;
export const REQUEST_TIMEOUT_MS = 10_000;
/** Tick cadence: minute-granularity countdown re-render + TTL-gated refresh check. */
export const WIDGET_TICK_MS = 60_000;

/** Why a fetch did not produce usable data (drives widget vs. command behavior). */
export type FetchFailureKind = "no-key" | "unauthorized" | "transient" | "payload";

export type FetchOutcome =
	| { ok: true; data: ParsedUsage }
	| { ok: false; kind: FetchFailureKind; error: string };

export async function fetchGoUsage(apiKey: string): Promise<FetchOutcome> {
	let res: Response;
	try {
		res = await fetch(USAGE_ENDPOINT, {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch {
		return { ok: false, kind: "transient", error: "Usage request failed (network error or timeout)." };
	}

	if (res.status === 401) {
		return { ok: false, kind: "unauthorized", error: "Plan/key rejected (HTTP 401) for opencode-go." };
	}
	if (!res.ok) {
		return { ok: false, kind: "transient", error: `Usage endpoint returned HTTP ${res.status}.` };
	}

	let json: unknown;
	try {
		json = await res.json();
	} catch {
		return { ok: false, kind: "payload", error: "Usage response was not valid JSON." };
	}

	const data = parseUsageResponse(json);
	if (!data.valid || data.windows.length === 0) {
		return { ok: false, kind: "payload", error: "Usage response contained no recognizable window data." };
	}
	return { ok: true, data };
}

/** HTTP-level single-flight: any caller shares the in-progress fetch. */
export function guardedFetch(
	getApiKey: () => Promise<string | undefined>,
	inflight: { value: Promise<FetchOutcome> | undefined },
): Promise<FetchOutcome> {
	if (inflight.value === undefined) {
		inflight.value = getApiKey()
			.then((key) => {
				if (!key) {
					return { ok: false, kind: "no-key", error: 'No API key configured for provider "opencode-go".' } as const;
				}
				return fetchGoUsage(key);
			})
			.finally(() => {
				inflight.value = undefined;
			});
	}
	return inflight.value;
}

/** Convenience: key from OpenCode's local auth store. */
export function fetchFromAuthStore(inflight: { value: Promise<FetchOutcome> | undefined }): Promise<FetchOutcome> {
	return guardedFetch(async () => readApiKeyFromAuthStore(), inflight);
}
