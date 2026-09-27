/**
 * Provider adapter contract.
 *
 * The gauge, the layout math and the TUI are provider-agnostic: an adapter
 * only has to answer two questions for one OpenCode provider id —
 *
 *   1. `credential()` — how do I authenticate? (API key in OpenCode's auth
 *      store, browser cookie, OAuth token file, …)
 *   2. `fetch(cred)` — give me the plan usage, normalized to `PlanUsage`.
 *
 * Adding a provider (OpenCode Zen, GitHub Copilot, Kiro, …) means adding one
 * file under `src/providers/` and registering it in `src/registry.ts`. Nothing
 * in `snapshot.ts`, `config.ts` or `tui.tsx` changes.
 *
 * Normalization rules (the same "degrade, never throw" contract the rest of
 * the plugin follows):
 *   - `windows` is a plan with rolling/weekly/monthly quotas. Pay-as-you-go
 *     providers have none; leave it empty and set `balance` instead.
 *   - Every field except `windows`/`balance` is optional. A missing value
 *     renders as `--` or is omitted — it never fails the fetch.
 *   - `PlanWindow` is structurally compatible with the ported
 *     `UsageWindowState` in `parser.ts`, so the rendering layer accepts both
 *     without conversion.
 */

/**
 * How a provider authenticates. Deliberately a union: API-key providers use
 * `bearer`, while OAuth/console-scraping providers (Copilot, Kiro) need
 * headers or cookies. A single `string` token shape would force adapter #3 to
 * be a rewrite.
 *
 * Credentials are used in-memory only. Adapters must never log, print or
 * persist them.
 */
export type Credential =
	| { kind: "bearer"; token: string }
	| { kind: "header"; name: string; value: string }
	| { kind: "cookie"; name: string; value: string };

/** One quota window, shaped like the ported `UsageWindowState`. */
export interface PlanWindow {
	/** Semantic window id (adapters may add their own, e.g. "daily"). */
	key: string;
	/** Short display label ("5h", "week", "month"). */
	label: string;
	/** Usage as a percentage (0–100+). Undefined when the API omitted it. */
	usagePercent?: number;
	/** Dollars spent in this window, when the provider reports it. */
	usageDollars?: number;
	/** Dollar limit for this window, when the provider reports one. */
	limitDollars?: number;
	/** Absolute epoch ms at which the window resets, when derivable. */
	resetsAtMs?: number;
	/** Seconds until reset, when reported. */
	resetInSec?: number;
	/** Raw status string from the API (e.g. "ok"), if present. */
	status?: string;
}

/** Remaining prepaid credit, for providers that bill by usage instead of windows. */
export interface PlanBalance {
	/** Remaining amount in `currency` units. */
	remaining: number;
	/** ISO currency code, or a provider-specific symbol. */
	currency: string;
}

/** Normalized plan usage for one provider, whatever its native shape was. */
export interface PlanUsage {
	/** The adapter id that produced this (an OpenCode providerID). */
	provider: string;
	/** Account/plan label when the provider reports one (e.g. an email). */
	planName?: string;
	/** Quota windows; empty for pure pay-as-you-go providers. */
	windows: PlanWindow[];
	/** Remaining credit; absent for pure subscription providers. */
	balance?: PlanBalance;
	/** Epoch ms of the fetch that produced this data. */
	fetchedMs: number;
	/** False when the payload contained nothing recognizable. */
	valid: boolean;
}

/** Why a fetch did not produce usable data (drives widget vs. command behavior). */
export type PlanFetchFailure = "no-credential" | "unauthorized" | "transient" | "payload";

export type PlanOutcome =
	| { ok: true; data: PlanUsage }
	| { ok: false; kind: PlanFetchFailure; error: string };

/** What the gauge is expected to be able to show for this provider. */
export type PlanKind = "windows" | "balance" | "both";

/**
 * One provider integration. `fetch` must resolve (never reject) so a broken
 * provider degrades to stale data instead of taking the TUI down.
 */
export interface PlanUsageAdapter {
	/** OpenCode `providerID` this adapter serves (e.g. "opencode-go"). */
	id: string;
	/** Display name in dialogs and errors (e.g. "OpenCode Go"). */
	label: string;
	/** What the gauge can render, used for capability checks and docs. */
	planKind: PlanKind;
	/** Resolve a credential, or undefined when the user has not set one up. */
	credential(): Promise<Credential | undefined>;
	/** Fetch and normalize plan usage. Never throws. */
	fetch(credential: Credential): Promise<PlanOutcome>;
}
