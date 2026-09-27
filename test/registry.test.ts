import { test } from "node:test";
import assert from "node:assert/strict";
import { ADAPTERS, ADAPTER_IDS, adapterForProvider, resolveAdapters } from "../src/registry.ts";
import { GO_ADAPTER, GO_ENDPOINT, GO_PROVIDER_ID } from "../src/providers/go.ts";
import { createPlanSource } from "../src/usage.ts";
import type { Credential, PlanOutcome, PlanUsageAdapter } from "../src/providers/types.ts";

/** Minimal adapter stub: fixed credential + fixed outcome, fetch call counter. */
function stubAdapter(
	id: string,
	options: { credential?: Credential | undefined; outcome: PlanOutcome; throws?: boolean },
): PlanUsageAdapter & { calls: number } {
	const adapter = {
		id,
		label: `Stub ${id}`,
		planKind: "windows" as const,
		calls: 0,
		async credential() {
			return options.credential;
		},
		async fetch(): Promise<PlanOutcome> {
			adapter.calls++;
			if (options.throws === true) throw new Error("boom");
			return options.outcome;
		},
	};
	return adapter;
}

const okOutcome: PlanOutcome = {
	ok: true,
	data: { provider: "stub", windows: [], fetchedMs: 1000, valid: true },
};

test("registry exposes the Go adapter and resolves it by provider id", () => {
	assert.ok(ADAPTERS.length >= 1);
	assert.ok(ADAPTER_IDS.includes(GO_PROVIDER_ID));
	assert.equal(adapterForProvider("opencode-go")?.id, GO_PROVIDER_ID);
	assert.equal(adapterForProvider("anthropic"), undefined);
	assert.equal(adapterForProvider(undefined), undefined);
});

test("Go adapter metadata matches the live endpoint", () => {
	assert.equal(GO_ADAPTER.id, "opencode-go");
	assert.equal(GO_ADAPTER.label, "OpenCode Go");
	assert.equal(GO_ADAPTER.planKind, "windows");
	assert.equal(GO_ENDPOINT, "https://opencode.ai/zen/go/v1/usage");
});

test("resolveAdapters: explicit list, \"all\", and unknown-id fallback", () => {
	assert.deepEqual(
		resolveAdapters(["opencode-go"]).map((a) => a.id),
		["opencode-go"],
	);
	assert.deepEqual(
		resolveAdapters(["all"]).map((a) => a.id),
		[...ADAPTER_IDS],
	);
	// A config naming only unknown providers must not leave the user with no gauge.
	assert.deepEqual(
		resolveAdapters(["nope"]).map((a) => a.id),
		[...ADAPTER_IDS],
	);
	assert.deepEqual(
		resolveAdapters([]).map((a) => a.id),
		[...ADAPTER_IDS],
	);
});

test("createPlanSource: missing credential is a no-credential failure, no fetch", async () => {
	const adapter = stubAdapter("stub", { credential: undefined, outcome: okOutcome });
	const outcome = await createPlanSource(adapter).fetch();
	assert.equal(outcome.ok, false);
	assert.equal(outcome.ok === false && outcome.kind, "no-credential");
	assert.equal(adapter.calls, 0);
});

test("createPlanSource: a throwing credential lookup degrades to no-credential", async () => {
	const adapter: PlanUsageAdapter = {
		id: "stub",
		label: "Stub",
		planKind: "windows",
		async credential(): Promise<Credential | undefined> {
			throw new Error("store unreadable");
		},
		async fetch(): Promise<PlanOutcome> {
			return okOutcome;
		},
	};
	const outcome = await createPlanSource(adapter).fetch();
	assert.equal(outcome.ok === false && outcome.kind, "no-credential");
});

test("createPlanSource: a throwing adapter.fetch degrades to transient", async () => {
	const adapter = stubAdapter("stub", {
		credential: { kind: "bearer", token: "t" },
		outcome: okOutcome,
		throws: true,
	});
	const outcome = await createPlanSource(adapter).fetch();
	assert.equal(outcome.ok === false && outcome.kind, "transient");
});

test("createPlanSource: concurrent callers share one in-flight fetch", async () => {
	const adapter = stubAdapter("stub", { credential: { kind: "bearer", token: "t" }, outcome: okOutcome });
	const source = createPlanSource(adapter);
	const [a, b, c] = await Promise.all([source.fetch(), source.fetch(), source.fetch()]);
	assert.equal(adapter.calls, 1);
	assert.ok(a.ok && b.ok && c.ok);
	// The snapshot survives for later TTL checks.
	assert.equal(source.fetchedAtMs(), 1000);
	assert.equal(source.snapshot()?.data.provider, "stub");
});

test("createPlanSource: a later failure keeps the last good snapshot", async () => {
	let fail = false;
	const adapter: PlanUsageAdapter = {
		id: "stub",
		label: "Stub",
		planKind: "windows",
		async credential() {
			return { kind: "bearer", token: "t" };
		},
		async fetch(): Promise<PlanOutcome> {
			if (fail) return { ok: false, kind: "transient", error: "later" };
			return okOutcome;
		},
	};
	const source = createPlanSource(adapter);
	assert.equal((await source.fetch()).ok, true);
	fail = true;
	assert.equal((await source.fetch()).ok, false);
	assert.equal(source.snapshot()?.data.provider, "stub", "stale snapshot must survive");
});
