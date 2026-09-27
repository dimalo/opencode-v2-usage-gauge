import { test } from "node:test";
import assert from "node:assert/strict";
import {
	NO_KEY_LIMIT_NOTE,
	OPENROUTER_ADAPTER,
	OPENROUTER_ENDPOINT,
	OPENROUTER_PROVIDER_ID,
} from "../src/providers/openrouter.ts";
import { joinSnapshotLines, layoutWidgetLine } from "../src/snapshot.ts";
import type { Credential, PlanUsage } from "../src/providers/types.ts";

const CRED: Credential = { kind: "bearer", token: "not-a-real-key" };

/**
 * Obviously-fake stand-in for the key's own label. Fixtures must be synthetic:
 * a fragment copied out of a live response is a credential leak, however short.
 */
const CREDENTIAL_LABEL_SENTINEL = "EXAMPLE-NOT-A-KEY";

/** Recorded-shaped `/api/v1/key` payload (docs example, values trimmed to 0/50/100). */
function keyPayload(data: Record<string, unknown> | null): unknown {
	return { data: { label: CREDENTIAL_LABEL_SENTINEL, usage: 25.5, rate_limit: { interval: "1h", requests: 1000, note: "deprecated" }, ...data } };
}

interface Stub {
	status: number;
	body: string;
	contentType?: string;
}

/** Install a fetch stub for one call; returns the restore function. */
function withFetch(stub: Stub, run: () => Promise<void>): Promise<void> {
	const original = globalThis.fetch;
	globalThis.fetch = (async () =>
		new Response(stub.body, {
			status: stub.status,
			headers: { "content-type": stub.contentType ?? "application/json" },
		})) as typeof fetch;
	return run().finally(() => {
		globalThis.fetch = original;
	});
}

async function fetchWith(body: unknown, status = 200): Promise<PlanUsage> {
	let result: PlanUsage | undefined;
	await withFetch({ status, body: JSON.stringify(body) }, async () => {
		const outcome = await OPENROUTER_ADAPTER.fetch(CRED);
		assert.equal(outcome.ok, true, "expected an ok outcome");
		if (outcome.ok) result = outcome.data;
	});
	assert.ok(result !== undefined);
	return result;
}

async function failureWith(stub: Stub): Promise<{ kind: string; error: string }> {
	let result: { kind: string; error: string } | undefined;
	await withFetch(stub, async () => {
		const outcome = await OPENROUTER_ADAPTER.fetch(CRED);
		assert.equal(outcome.ok, false, "expected a failure outcome");
		if (!outcome.ok) result = { kind: outcome.kind, error: outcome.error };
	});
	assert.ok(result !== undefined);
	return result;
}

test("adapter metadata matches the documented endpoint", () => {
	assert.equal(OPENROUTER_ADAPTER.id, "openrouter");
	assert.equal(OPENROUTER_ADAPTER.label, "OpenRouter");
	assert.equal(OPENROUTER_ADAPTER.planKind, "windows");
	assert.equal(OPENROUTER_PROVIDER_ID, "openrouter");
	assert.equal(OPENROUTER_ENDPOINT, "https://openrouter.ai/api/v1/key");
});

test("a non-bearer credential is a no-credential failure, no request", async () => {
	const outcome = await OPENROUTER_ADAPTER.fetch({ kind: "cookie", name: "a", value: "b" });
	assert.equal(outcome.ok, false);
	assert.equal(outcome.ok === false && outcome.kind, "no-credential");
});

test("per-key cap: percentage and dollars come from limit_remaining/limit", async () => {
	const data = await fetchWith(keyPayload({ limit: 100, limit_remaining: 74.5, limit_reset: "monthly" }));
	assert.equal(data.windows.length, 1);
	const window = data.windows[0]!;
	assert.equal(window.usagePercent, 25.5);
	assert.equal(window.usageDollars, 25.5);
	assert.equal(window.limitDollars, 100);
	assert.equal(window.key, "monthly");
	assert.equal(window.label, "mo");
	assert.equal(data.balance, undefined, "the account balance is never exposed");
	assert.equal(data.note, undefined);
});

test("exhausted cap reads 100%, never more than the reported denominator", async () => {
	const data = await fetchWith(keyPayload({ limit: 50, limit_remaining: 0, limit_reset: "daily" }));
	const window = data.windows[0]!;
	assert.equal(window.usagePercent, 100);
	assert.equal(window.usageDollars, 50);
	assert.equal(window.key, "daily");
	assert.equal(window.label, "day", "a daily cap must not be labelled 5h");
	assert.equal(window.resetsAtMs, undefined, "the reset instant is not documented");
});

test("labels per cadence: daily uses its own label, canonical keys stay canonical", async () => {
	const labels: Record<string, string> = {};
	for (const cadence of ["daily", "weekly", "monthly"]) {
		const data = await fetchWith(keyPayload({ limit: 10, limit_remaining: 5, limit_reset: cadence }));
		labels[cadence] = data.windows[0]!.label;
	}
	assert.deepEqual(labels, { daily: "day", weekly: "wk", monthly: "mo" });
});

test("an undocumented cadence string gets its own label, not \"5h\"", async () => {
	const data = await fetchWith(keyPayload({ limit: 10, limit_remaining: 5, limit_reset: "fortnightly" }));
	const window = data.windows[0]!;
	assert.equal(window.key, "keycap");
	assert.equal(window.label, "cap");
	const layout = layoutWidgetLine(data.windows, Date.now(), 80);
	assert.equal(layout.segments[0]?.label, "cap");
});

test("limit null (the default) yields no window, a lifetime spend figure, and a note", async () => {
	const data = await fetchWith(keyPayload({ limit: null, limit_remaining: null, limit_reset: null }));
	assert.deepEqual(data.windows, [], "no denominator → no bar may be drawn");
	assert.equal(data.note, NO_KEY_LIMIT_NOTE);
	assert.deepEqual(
		data.spend,
		{ amount: 25.5, currency: "USD", scope: "key" },
		"the key's lifetime usage is a real number, shown without a bar",
	);
	assert.equal(joinSnapshotLines([], data.note), NO_KEY_LIMIT_NOTE, "/usage must not be blank");
	assert.equal(layoutWidgetLine(data.windows, Date.now(), 80).segments.length, 0);
});

test("no usage field → no spend figure (a missing number is absent, not zero)", async () => {
	const data = await fetchWith(keyPayload({ limit: null, limit_remaining: null, usage: null }));
	assert.deepEqual(data.windows, []);
	assert.equal(data.spend, undefined);
	assert.equal(data.note, NO_KEY_LIMIT_NOTE);
});

test("a capped key carries no separate spend line (the window already has the dollars)", async () => {
	const data = await fetchWith(keyPayload({ limit: 100, limit_remaining: 74.5, limit_reset: "monthly" }));
	assert.equal(data.windows.length, 1);
	assert.equal(data.spend, undefined);
});

test("limit 0 is treated as no cap, never as a denominator", async () => {
	const data = await fetchWith(keyPayload({ limit: 0, limit_remaining: 0, limit_reset: "daily" }));
	assert.deepEqual(data.windows, []);
	assert.equal(data.note, NO_KEY_LIMIT_NOTE);
});

test("a missing limit_remaining never divides and never yields NaN/Infinity", async () => {
	for (const payload of [
		keyPayload({ limit: 100, limit_reset: "weekly" }),
		keyPayload({ limit: 100, limit_remaining: null, limit_reset: "weekly" }),
		keyPayload({ limit: 100, limit_remaining: "74.5", limit_reset: "weekly" }),
	]) {
		const data = await fetchWith(payload);
		assert.deepEqual(data.windows, []);
		assert.equal(data.note, NO_KEY_LIMIT_NOTE);
	}
});

test("non-finite numbers are rejected instead of rendered", async () => {
	// JSON cannot carry NaN/Infinity, so a string is the realistic garbage case;
	// the finite() guard covers all of them.
	const data = await fetchWith(keyPayload({ limit: "100", limit_remaining: "74.5", limit_reset: "daily" }));
	assert.deepEqual(data.windows, []);
});

test("a payload with no data object is a payload failure", async () => {
	for (const body of [{}, { data: null }, { data: "nope" }, { data: [] }]) {
		const failure = await failureWith({ status: 200, body: JSON.stringify(body) });
		assert.equal(failure.kind, "payload", JSON.stringify(body));
	}
});

test("HTTP 401 is unauthorized, other non-OK statuses are transient", async () => {
	assert.equal((await failureWith({ status: 401, body: "{}" })).kind, "unauthorized");
	assert.equal((await failureWith({ status: 403, body: "{}" })).kind, "transient");
	assert.equal((await failureWith({ status: 500, body: "{}" })).kind, "transient");
});

test("a non-JSON body is a payload failure", async () => {
	const failure = await failureWith({
		status: 200,
		body: "<html>maintenance</html>",
		contentType: "text/html",
	});
	assert.equal(failure.kind, "payload");
});

test("the deprecated rate_limit object is ignored", async () => {
	const data = await fetchWith({
		data: {
			limit: 100,
			limit_remaining: 50,
			limit_reset: "daily",
			usage: 25.5,
			// A deprecated block full of numbers that would be tempting to read.
			rate_limit: { requests: 1000, interval: "1h", note: "This field is deprecated." },
		},
	});
	assert.equal(data.windows.length, 1);
	const window = data.windows[0]!;
	assert.equal(window.usagePercent, 50, "only the credit cap feeds the gauge");
	assert.equal(window.usageDollars, 50);
	assert.equal(window.limitDollars, 100);
});

test("the key's own label (a credential fragment) is never surfaced", async () => {
	const data = await fetchWith(keyPayload({ label: CREDENTIAL_LABEL_SENTINEL, limit: 100, limit_remaining: 1 }));
	assert.equal(data.planName, undefined);
	assert.equal(JSON.stringify(data).includes(CREDENTIAL_LABEL_SENTINEL), false);
});

test("no credential value is embedded in any failure message", async () => {
	const failure = await failureWith({ status: 500, body: "{}" });
	assert.equal(failure.error.includes("not-a-real-key"), false);
});

test("joinSnapshotLines: real lines win, empty falls back to the note", () => {
	assert.equal(joinSnapshotLines(["a", "b"], "note"), "a\nb");
	assert.equal(joinSnapshotLines([], "note"), "note");
	assert.equal(joinSnapshotLines([], undefined), "no usage data reported.");
	assert.equal(joinSnapshotLines([], ""), "no usage data reported.");
});

test("the cap case renders a bar in the single-line gauge", async () => {
	const data = await fetchWith(keyPayload({ limit: 100, limit_remaining: 12, limit_reset: "daily" }));
	const layout = layoutWidgetLine(data.windows, Date.now(), 60);
	assert.equal(layout.segments.length, 1);
	const segment = layout.segments[0]!;
	assert.equal(segment.label, "day");
	assert.equal(segment.pctText, "88%");
	assert.ok(segment.gaugeWidth >= 6);
	assert.ok(segment.divider > 0, "88% of the track must be filled");
});

test("an inconsistent payload (remaining > limit) floors at 0%, never a negative bar", async () => {
	const data = await fetchWith(keyPayload({ limit: 100, limit_remaining: 140 }));
	assert.equal(data.windows.length, 1);
	assert.equal(data.windows[0]!.usagePercent, 0, "must not render as -40%");
	assert.equal(data.windows[0]!.usageDollars, -40, "the raw dollar delta stays truthful");
});
