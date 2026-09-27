/**
 * Local credits-consumed meter.
 *
 * `PlanUsageAdapter.fetch()` is network-sourced by contract, and that is the
 * right place for anything a billing API reports. Credits *consumed* are the
 * exception: for OpenCode Zen the number is real but it is not a plan
 * response — it is the sum of the `cost` OpenCode already computed for the
 * assistant messages in the current session, which lives in the TUI data
 * layer, not in a provider API. So it is computed here and folded into the
 * TUI's snapshot, and the adapter keeps describing what the network knows.
 *
 * Properties this module guarantees, because the TUI is not the place to
 * re-derive them:
 *
 *   - **Pure.** No module state, no accumulation, no timers. Calling it twice
 *     for the same session returns the same number, so the widget, the sidebar
 *     and `/usage` cannot double-count the same messages.
 *   - **Per provider.** Only assistant messages whose `model.providerID`
 *     matches are summed; a session that mixes Zen and Anthropic models
 *     reports the Zen part only.
 *   - **Per session family.** `data.session.family()` lists a session's
 *     subagent sessions; their messages are part of the same spend and are
 *     counted once (a `Set` guards a repeated id).
 *   - **Degrades, never throws.** A session with no assistant messages yet, a
 *     message without `cost`, an unreadable list → `undefined`, which the
 *     renderer treats as "nothing to show".
 *
 * Types are the narrow structural slices the meter needs (checked against
 * `node_modules/@opencode/client/dist/promise/generated/types.d.ts`: assistant
 * messages carry `model: ModelRef` with `providerID` and `cost?: MoneyUSD`,
 * and `MoneyUSD` is a plain number), so the tests can drive it with plain
 * objects and no TUI.
 */

import { visibleWidth } from "./ansi.ts";
import { formatDollars } from "./parser.ts";
import type { PlanSpend, PlanUsage, SpendScope } from "./providers/types.ts";

/** The slice of the TUI data layer the meter reads. */
export interface SessionDataLike {
	readonly session: {
		/** All sessions in this session's family (subagents included). */
		family(sessionID: string): readonly string[];
		readonly message: {
			/** Messages of one session, oldest first. */
			list(sessionID: string): readonly unknown[];
		};
	};
}

/** What one measurement produced. */
export interface SessionSpend {
	/** Total cost of the provider's assistant messages in the family. */
	amount: number;
	/** Assistant messages of that provider that carried a `cost`. */
	messageCount: number;
	/** Sessions in the family that contributed (>= 1). */
	sessionCount: number;
}

/**
 * Sum the credits consumed by `providerID` across one session family.
 *
 * Returns undefined when there is nothing honest to show — no assistant
 * message from that provider, or none of them reported a cost. A spent amount
 * of 0 with counted messages is a real reading and IS returned.
 */
export function computeSessionSpend(
	data: SessionDataLike,
	sessionID: string,
	providerID: string,
): SessionSpend | undefined {
	if (sessionID === "" || providerID === "") return undefined;

	// `family()` is documented as the session's family, but be defensive about
	// the root not being included and about a repeated id: both would count the
	// same messages twice.
	const ids = new Set<string>([sessionID]);
	try {
		for (const id of data.session.family(sessionID)) {
			if (typeof id === "string" && id !== "") ids.add(id);
		}
	} catch {
		// Family lookup failed → the session itself is still worth measuring.
	}

	let amount = 0;
	let messageCount = 0;
	let sessionCount = 0;
	for (const id of ids) {
		let messages: readonly unknown[];
		try {
			messages = data.session.message.list(id);
		} catch {
			continue; // one unreadable session must not sink the family total
		}
		if (!Array.isArray(messages)) continue;
		let sessionMessages = 0;
		for (const message of messages) {
			if (!isRecord(message)) continue;
			if (message.type !== "assistant") continue;
			const model = message.model;
			if (!isRecord(model) || model.providerID !== providerID) continue;
			const cost = message.cost;
			// MoneyUSD is a number; reject NaN/Infinity/negatives rather than
			// rendering a garbage total.
			if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) continue;
			amount += cost;
			messageCount++;
			sessionMessages++;
		}
		if (sessionMessages > 0) sessionCount++;
	}

	if (messageCount === 0) return undefined;
	return { amount, messageCount, sessionCount };
}

/**
 * True when a snapshot carries at least one number worth rendering.
 *
 * The multi-line layout uses this to stay silent instead of printing a bare
 * section title for a provider that reported nothing (a Zen session with no
 * assistant message yet, say). A `spend` amount counts: it is a real measured
 * number. `note` never counts: it explains, it does not measure.
 */
export function hasRenderableData(data: PlanUsage): boolean {
	return data.windows.length > 0 || data.balance !== undefined || data.spend !== undefined;
}

/** Build the `PlanSpend` shape the snapshot carries (Zen bills in USD). */
export function toPlanSpend(spend: SessionSpend, scope: SpendScope = "session"): PlanSpend {
	return { amount: spend.amount, currency: "USD", scope };
}

/** Human label for a scope, used in the dialog and the sidebar. */
export function spendScopeLabel(scope: SpendScope): string {
	if (scope === "account") return "account";
	if (scope === "key") return "this key";
	return "session";
}

/** The measured part of a spend-only widget line (the TUI colors it). */
export function spendWidgetBody(spent: PlanSpend): string {
	return `spent ${formatDollars(spent.amount)} ${spent.currency} · ${spendScopeLabel(spent.scope)}`;
}

/**
 * The full one-line text for a spend-only widget, or undefined when it does
 * not fit the caller's cell budget.
 *
 * The prompt footer is a SHARED row (see `layoutWidgetLine`'s width notes), so
 * a line that does not fit must disappear rather than wrap — the same rule the
 * windows path follows by dropping segments. The TUI uses this for the fit
 * decision and `spendWidgetBody` for the colored spans, so both agree.
 */
export function spendWidgetLine(spent: PlanSpend, prefix: string, budget: number): string | undefined {
	const line = `${prefix}${spendWidgetBody(spent)}`;
	// +1 cell for the " (stale)" marker the TUI appends when a refresh failed.
	if (visibleWidth(line) > budget - 1) return undefined;
	return line;
}

/** Full-width text form for the sidebar and the `/usage` dialog. */
export function spendDetailText(spent: PlanSpend): string {
	return `spent ${spent.amount.toFixed(2)} ${spent.currency} (${spendScopeLabel(spent.scope)})`;
}

/** The sidebar form: the label is rendered separately, so no leading word. */
export function spendAmountText(spent: PlanSpend): string {
	return `${spent.amount.toFixed(2)} ${spent.currency} · ${spendScopeLabel(spent.scope)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
