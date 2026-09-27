/**
 * Fetch + apply plumbing shared by every provider adapter.
 *
 * This layer knows nothing about any specific billing API: it resolves the
 * adapter's credential, calls the adapter once at a time (single-flight),
 * caches the result for `CACHE_TTL_MS`, and keeps the last good snapshot when
 * a refresh fails transiently. Provider specifics live in `src/providers/`.
 *
 * Mirrors the pi extension's behavior: ~5 min cache TTL, stale-data fallback,
 * and silent degradation (never crash, never leak a credential).
 */

import type { PlanOutcome, PlanUsageAdapter } from "./providers/types.ts";

/** Re-fetch at most every 5 minutes (the /usage command always fetches fresh). */
export const CACHE_TTL_MS = 5 * 60 * 1000;
/** Tick cadence: minute-granularity countdown re-render + TTL-gated refresh check. */
export const WIDGET_TICK_MS = 60_000;

/** Why a fetch did not produce usable data (drives widget vs. command behavior). */
export type FetchFailureKind = "no-credential" | "unauthorized" | "transient" | "payload";

export type FetchOutcome = PlanOutcome;

/** One adapter's shared fetch state: in-flight promise + last good result. */
export interface PlanSource {
	readonly adapter: PlanUsageAdapter;
	/** Fetch through the adapter, sharing any in-flight request. */
	fetch(): Promise<FetchOutcome>;
	/** Epoch ms of the last successful fetch, or undefined. */
	fetchedAtMs(): number | undefined;
	/** Last successful snapshot, or undefined. */
	snapshot(): PlanOutcome & { ok: true } | undefined;
}

/** Create the shared, single-flight source for one adapter. */
export function createPlanSource(adapter: PlanUsageAdapter): PlanSource {
	const inflight: { value: Promise<FetchOutcome> | undefined } = { value: undefined };
	let lastGood: (PlanOutcome & { ok: true }) | undefined;

	const run = async (): Promise<FetchOutcome> => {
		if (inflight.value !== undefined) return inflight.value;
		inflight.value = (async () => {
			// A credential lookup can throw (unreadable store, exotic provider);
			// that is a missing credential, not a crash.
			let credential;
			try {
				credential = await adapter.credential();
			} catch {
				credential = undefined;
			}
			if (credential === undefined) {
				return {
					ok: false,
					kind: "no-credential",
					error: `No credentials configured for provider "${adapter.id}".`,
				} as const;
			}
			try {
				const outcome = await adapter.fetch(credential);
				if (outcome.ok) lastGood = outcome;
				return outcome;
			} catch {
				return {
					ok: false,
					kind: "transient",
					error: `${adapter.label} usage request failed.`,
				} as const;
			}
		})().finally(() => {
			inflight.value = undefined;
		});
		return inflight.value;
	};

	return {
		adapter,
		fetch: run,
		fetchedAtMs: () => lastGood?.data.fetchedMs,
		snapshot: () => lastGood,
	};
}
