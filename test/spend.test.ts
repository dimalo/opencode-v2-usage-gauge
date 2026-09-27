import { test } from "node:test";
import assert from "node:assert/strict";
import {
	computeSessionSpend,
	hasRenderableData,
	spendDetailText,
	spendAmountText,
	spendScopeLabel,
	spendWidgetBody,
	spendWidgetLine,
	toPlanSpend,
	type SessionDataLike,
} from "../src/spend.ts";
import type { PlanUsage } from "../src/providers/types.ts";

/**
 * Recorded message shapes, taken from
 * `node_modules/@opencode/client/dist/promise/generated/types.d.ts`:
 * assistant messages carry `model: ModelRef` (`{id, providerID}`) and
 * `cost?: MoneyUSD` (a plain number).
 */
function assistant(providerID: string, cost: number | undefined): Record<string, unknown> {
	const message: Record<string, unknown> = {
		id: `msg-${providerID}-${String(cost)}`,
		type: "assistant",
		model: { id: `${providerID}/model`, providerID },
	};
	if (cost !== undefined) message.cost = cost;
	return message;
}

function user(text: string): Record<string, unknown> {
	return { id: `user-${text}`, type: "user", text };
}

/** Stub of the TUI data layer: session families with recorded message lists. */
function stubData(family: Record<string, readonly unknown[]>, rootOf: string[] = []): SessionDataLike {
	return {
		session: {
			family: (sessionID) => (rootOf.includes(sessionID) ? rootOf : [sessionID]),
			message: { list: (sessionID) => family[sessionID] ?? [] },
		},
	};
}

/** OpenCode Zen provider id; the pay-as-you-go case these helpers exist for. */
const ZEN_PROVIDER_ID = "opencode";

test("no assistant messages at all → nothing to show", () => {
	const data = stubData({ ses_1: [user("hi")] });
	assert.equal(computeSessionSpend(data, "ses_1", ZEN_PROVIDER_ID), undefined);
});

test("an empty session → nothing to show", () => {
	assert.equal(computeSessionSpend(stubData({}), "ses_1", ZEN_PROVIDER_ID), undefined);
});

test("only user/system messages → nothing to show", () => {
	const data = stubData({
		ses_1: [user("a"), { id: "s", type: "system" }, { id: "idle", type: "idle" }],
	});
	assert.equal(computeSessionSpend(data, "ses_1", ZEN_PROVIDER_ID), undefined);
});

test("assistant messages without a cost are ignored (no invented zero total)", () => {
	const data = stubData({ ses_1: [assistant("opencode", undefined), assistant("opencode", undefined)] });
	assert.equal(computeSessionSpend(data, "ses_1", ZEN_PROVIDER_ID), undefined);
});

test("a real 0.00 cost is a reading, not an absence", () => {
	const data = stubData({ ses_1: [assistant("opencode", 0)] });
	const spend = computeSessionSpend(data, "ses_1", ZEN_PROVIDER_ID);
	assert.equal(spend?.amount, 0);
	assert.equal(spend?.messageCount, 1);
	assert.equal(spend?.sessionCount, 1);
});

test("spend sums the provider's assistant messages in one session", () => {
	const data = stubData({
		ses_1: [user("q"), assistant("opencode", 0.1), assistant("opencode", 0.25), assistant("opencode", 0)],
	});
	const spend = computeSessionSpend(data, "ses_1", ZEN_PROVIDER_ID);
	assert.equal(spend?.amount, 0.35);
	assert.equal(spend?.messageCount, 3);
	assert.equal(spend?.sessionCount, 1);
});

test("messages from another provider are ignored", () => {
	const data = stubData({
		ses_1: [
			assistant("opencode", 0.1),
			assistant("anthropic", 9.99),
			assistant("opencode-go", 4.2),
			assistant("opencode", 0.15),
		],
	});
	const spend = computeSessionSpend(data, "ses_1", ZEN_PROVIDER_ID);
	assert.equal(spend?.amount, 0.25, "only opencode/ messages count");
	assert.equal(spend?.messageCount, 2);
});

test("subagent sessions in the family are counted once each", () => {
	const data = stubData(
		{
			ses_root: [user("go"), assistant("opencode", 0.2)],
			ses_sub_a: [assistant("opencode", 0.05), assistant("anthropic", 3)],
			ses_sub_b: [assistant("opencode", 0.1)],
		},
		["ses_root", "ses_sub_a", "ses_sub_b"],
	);
	const spend = computeSessionSpend(data, "ses_root", ZEN_PROVIDER_ID);
	assert.equal(spend?.amount, 0.35);
	assert.equal(spend?.messageCount, 3);
	assert.equal(spend?.sessionCount, 3);
});

test("a family listed twice does not double-count", () => {
	const data = stubData({ ses_root: [assistant("opencode", 0.5)] }, ["ses_root", "ses_root", "ses_root"]);
	const spend = computeSessionSpend(data, "ses_root", ZEN_PROVIDER_ID);
	assert.equal(spend?.amount, 0.5, "the same session id must not be summed twice");
	assert.equal(spend?.messageCount, 1);
});

test("family() omitting the root session still counts it", () => {
	const data = stubData({ ses_root: [assistant("opencode", 0.4)] }, ["ses_sub"]);
	const spend = computeSessionSpend(data, "ses_root", ZEN_PROVIDER_ID);
	assert.equal(spend?.amount, 0.4);
});

test("the measurement is pure: repeated calls never accumulate", () => {
	const data = stubData({ ses_1: [assistant("opencode", 0.3)] });
	const first = computeSessionSpend(data, "ses_1", ZEN_PROVIDER_ID);
	const second = computeSessionSpend(data, "ses_1", ZEN_PROVIDER_ID);
	const third = computeSessionSpend(data, "ses_1", ZEN_PROVIDER_ID);
	assert.deepEqual(first, second);
	assert.deepEqual(second, third);
	assert.equal(third?.amount, 0.3, "widget, sidebar and /usage each read 0.30, never 0.60/0.90");
});

test("a throwing family lookup or message list degrades, never throws", () => {
	const data: SessionDataLike = {
		session: {
			family: () => {
				throw new Error("store gone");
			},
			message: {
				list: (sessionID) => {
					if (sessionID === "ses_1") return [assistant("opencode", 0.75)];
					throw new Error("store gone");
				},
			},
		},
	};
	const spend = computeSessionSpend(data, "ses_1", ZEN_PROVIDER_ID);
	assert.equal(spend?.amount, 0.75, "the readable session is still measured");
});

test("garbage input (non-objects, non-numbers, negatives) is skipped", () => {
	const data = stubData({
		ses_1: [
			null,
			"nope",
			[],
			{ type: "assistant" },
			{ type: "assistant", model: { providerID: "opencode" }, cost: "1.00" },
			{ type: "assistant", model: { providerID: "opencode" }, cost: Number.NaN },
			{ type: "assistant", model: { providerID: "opencode" }, cost: -1 },
			assistant("opencode", 0.6),
		],
	});
	const spend = computeSessionSpend(data, "ses_1", ZEN_PROVIDER_ID);
	assert.equal(spend?.amount, 0.6);
	assert.equal(spend?.messageCount, 1);
});

test("empty provider or session id → undefined", () => {
	const data = stubData({ ses_1: [assistant("opencode", 1)] });
	assert.equal(computeSessionSpend(data, "", ZEN_PROVIDER_ID), undefined);
	assert.equal(computeSessionSpend(data, "ses_1", ""), undefined);
});

test("toPlanSpend normalizes to the snapshot shape (Zen bills in USD)", () => {
	const spent = toPlanSpend({ amount: 1.005, messageCount: 2, sessionCount: 1 });
	assert.deepEqual(spent, { amount: 1.005, currency: "USD", scope: "session" });
	assert.equal(toPlanSpend({ amount: 1, messageCount: 1, sessionCount: 1 }, "account").scope, "account");
	assert.equal(spendScopeLabel("session"), "session");
	assert.equal(spendScopeLabel("account"), "account");
	assert.equal(spendScopeLabel("key"), "this key");
});

test("spend text: compact widget body, detail text for the sidebar/dialog", () => {
	const spent = toPlanSpend({ amount: 12.5, messageCount: 3, sessionCount: 1 });
	assert.equal(spendWidgetBody(spent), "spent $12.50 USD · session");
	assert.equal(spendDetailText(spent), "spent 12.50 USD (session)");
	assert.equal(spendAmountText(spent), "12.50 USD · session");
	assert.equal(spendWidgetBody(toPlanSpend({ amount: 0, messageCount: 1, sessionCount: 1 })), "spent $0 USD · session");
	assert.equal(spendWidgetBody(toPlanSpend({ amount: 2, messageCount: 1, sessionCount: 1 }, "account")), "spent $2 USD · account");
});

test("spend widget line honors the shared-row width budget", () => {
	const spent = toPlanSpend({ amount: 1234.56, messageCount: 9, sessionCount: 1 });
	assert.equal(spendWidgetLine(spent, "Zen ", 60), "Zen spent $1234.56 USD · session"); // one space after the tag
	// Below the measured width the line disappears rather than wrapping
	// (the line is 32 cells; the budget also reserves 1 for " (stale)").
	assert.equal(spendWidgetLine(spent, "Zen ", 30), undefined);
	// The prefix is measured too — a long provider tag cannot escape the budget.
	assert.equal(spendWidgetLine(spent, "A very long provider tag ", 40), undefined);
});

test("hasRenderableData: a note is not a number", () => {
	// Stands in for a pay-as-you-go provider (OpenCode Zen) that can report
	// neither windows nor a balance: a note must not count as data.
	const payAsYouGo: PlanUsage = {
		provider: "opencode",
		windows: [],
		fetchedMs: 0,
		valid: true,
		note: "No balance API yet (anomalyco/opencode#44189).",
	};
	assert.equal(hasRenderableData(payAsYouGo), false, "no bare section title for a provider with no data");
	assert.equal(hasRenderableData({ ...payAsYouGo, windows: [{ key: "rolling", label: "5h" }] }), true);
	assert.equal(
		hasRenderableData({ ...payAsYouGo, balance: { remaining: 1, currency: "USD" } }),
		true,
	);
	// A directly reported spend amount (OpenRouter's key lifetime usage) is a
	// real number, so it counts even with no windows and no balance.
	assert.equal(
		hasRenderableData({ ...payAsYouGo, spend: { amount: 17.1, currency: "USD", scope: "key" } }),
		true,
	);
});
