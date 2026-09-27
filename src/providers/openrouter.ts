/**
 * OpenRouter per-key credit-cap adapter.
 *
 * Endpoint: `GET https://openrouter.ai/api/v1/key` (Bearer auth, documented at
 * https://openrouter.ai/docs/api_reference/limits). A normal (non-management)
 * key can call it, so the key already connected in OpenCode's auth store under
 * the provider id `openrouter` is all we need. The key is never logged, printed
 * or persisted.
 *
 * What the gauge can honestly show here, and nothing more:
 *
 *   - OpenRouter exposes a **per-key spending cap** (`limit`, `limit_remaining`,
 *     `limit_reset`). With `limit > 0` the mapping onto `PlanWindow` is exact:
 *     `usagePercent = (1 - limit_remaining/limit) * 100`, and the dollars are
 *     `limit - limit_remaining` of `limit`.
 *   - With `limit` null — the default for most keys — there is no denominator.
 *     A bar without a denominator is a lie, so the snapshot carries NO window
 *     and a `note` instead. The key's lifetime `usage` is still a real number,
 *     so it is shown as a measured amount (`spend`, `scope: "key"`) rather than
 *     nothing: the gauge reads `spent $17.10 USD · this key` and `/usage`
 *     explains why there is no bar.
 *   - The **account** credit balance is not exposed by any endpoint, so
 *     `PlanUsage.balance` is never filled. `/api/v1/credits` returns two
 *     CUMULATIVE lifetime counters (`total_credits`, `total_usage`); a balance
 *     derived from those breaks on refunds, negative carryover and fee
 *     divergence, so it is deliberately not used. Several popular projects
 *     derive one anyway and are wrong.
 *   - `rate_limit` is documented as deprecated ("safe to ignore") and is
 *     ignored here.
 *   - `/api/v1/activity` and `/api/v1/keys` need a *management* key, which
 *     cannot call completions and so is never in the auth store. Out of scope.
 *
 * Reset timing: `limit_reset` is a CADENCE ("daily" | "weekly" | "monthly" |
 * null), not a timestamp, and OpenRouter's docs do not document the instant at
 * which the per-key cap resets. The docs pin UTC boundaries for the
 * `usage_daily` / `usage_weekly` / `usage_monthly` counters and for the
 * free-model request counter, but never state that the credit cap resets on
 * those boundaries. So `resetsAtMs` is left undefined: an invented countdown
 * is worse than none.
 */

import { readApiKeyFromAuthStore } from "../auth.ts";
import type {
	Credential,
	PlanOutcome,
	PlanSpend,
	PlanUsage,
	PlanUsageAdapter,
	PlanWindow,
} from "./types.ts";

export const OPENROUTER_PROVIDER_ID = "openrouter";
export const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/key";
export const OPENROUTER_REQUEST_TIMEOUT_MS = 10_000;

/** Shown by `/usage` when the key has no per-key cap (there is nothing to bar). */
export const NO_KEY_LIMIT_NOTE =
	"no per-key credit limit on this OpenRouter key, so there is no budget to gauge.";

/** Cadence → the window's semantic key and short label. */
const CADENCES: Record<string, { key: string; label: string }> = {
	daily: { key: "daily", label: "day" },
	weekly: { key: "weekly", label: "wk" },
	monthly: { key: "monthly", label: "mo" },
};

/** Fallback for an undocumented cadence string: never claim a canonical window. */
const UNKNOWN_CADENCE = { key: "keycap", label: "cap" } as const;

export const OPENROUTER_ADAPTER: PlanUsageAdapter = {
	id: OPENROUTER_PROVIDER_ID,
	label: "OpenRouter",
	planKind: "windows",

	async credential(): Promise<Credential | undefined> {
		const key = await readApiKeyFromAuthStore(OPENROUTER_PROVIDER_ID);
		return key === undefined ? undefined : { kind: "bearer", token: key };
	},

	async fetch(credential: Credential): Promise<PlanOutcome> {
		if (credential.kind !== "bearer") {
			return { ok: false, kind: "no-credential", error: "Expected an API key for OpenRouter." };
		}

		let res: Response;
		try {
			res = await fetch(OPENROUTER_ENDPOINT, {
				headers: { Authorization: `Bearer ${credential.token}` },
				signal: AbortSignal.timeout(OPENROUTER_REQUEST_TIMEOUT_MS),
			});
		} catch {
			return { ok: false, kind: "transient", error: "Key request failed (network error or timeout)." };
		}

		if (res.status === 401) {
			return { ok: false, kind: "unauthorized", error: "Plan/key rejected (HTTP 401) for openrouter." };
		}
		if (!res.ok) {
			return { ok: false, kind: "transient", error: `Key endpoint returned HTTP ${res.status}.` };
		}

		let json: unknown;
		try {
			json = await res.json();
		} catch {
			return { ok: false, kind: "payload", error: "Key response was not valid JSON." };
		}

		const data = isRecord(json) ? json.data : undefined;
		if (!isRecord(data)) {
			return { ok: false, kind: "payload", error: "Key response contained no `data` object." };
		}

		const window = parseCap(data);
		const nowMs = Date.now();
		const payload: PlanUsage = {
			provider: OPENROUTER_PROVIDER_ID,
			// A plan label is the key's own name, which is a fragment of the
			// credential — never surface it. (Test fixtures use an obviously
			// fake sentinel, never a fragment copied from a live response.)
			windows: window === undefined ? [] : [window],
			// No cap → no bar, but the key's lifetime usage is still a real
			// number the API reports, so show it as a measured amount (never a
			// percentage). With a cap the window already carries the dollars,
			// so a second spend line would be redundant.
			spend: window === undefined ? lifetimeSpend(data) : undefined,
			note: window === undefined ? NO_KEY_LIMIT_NOTE : undefined,
			fetchedMs: nowMs,
			valid: true,
		};
		return { ok: true, data: payload };
	},
};

/**
 * The per-key cap as one window, or undefined when there is no denominator.
 *
 * Every field is nullable in the documented schema, and a null is ABSENT, not
 * zero: a missing `limit_remaining` must not divide, and a `limit` of 0 must
 * not either.
 */
function parseCap(data: Record<string, unknown>): PlanWindow | undefined {
	const limit = finite(data.limit);
	const remaining = finite(data.limit_remaining);
	if (limit === undefined || limit <= 0 || remaining === undefined) return undefined;

	const cadence = typeof data.limit_reset === "string" ? data.limit_reset.toLowerCase() : "";
	const { key, label } = CADENCES[cadence] ?? UNKNOWN_CADENCE;

	return {
		key,
		label,
		// Floored at 0: an inconsistent API response (remaining > limit) must
		// not render as "-4%". The upper end stays open, because a genuine
		// overage above 100% is real information (the Go path does the same).
		usagePercent: Math.max(0, (1 - remaining / limit) * 100),
		usageDollars: limit - remaining,
		limitDollars: limit,
		// Deliberately undefined: the reset instant is not documented.
		resetsAtMs: undefined,
	};
}

/**
 * The key's lifetime usage in USD, when the API reports a finite number.
 *
 * `usage` is the key's cumulative spend — a real, directly reported number, so
 * it is shown as a measured amount with `scope: "key"`. It is NOT a budget and
 * NOT a percentage: there is no denominator, so no bar may be drawn from it.
 */
function lifetimeSpend(data: Record<string, unknown>): PlanSpend | undefined {
	const usage = finite(data.usage);
	if (usage === undefined || usage < 0) return undefined;
	return { amount: usage, currency: "USD", scope: "key" };
}

/** A finite number, or undefined for null/missing/NaN/±Infinity/garbage. */
function finite(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
