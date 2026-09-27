import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUsageCache, serializeUsageCache } from "../src/cache.ts";
import type { ParsedUsage } from "../src/parser.ts";

const FETCHED_AT_MS = Date.parse("2026-08-16T12:00:00.000Z");
const RESET_MS = Date.parse("2026-08-16T17:30:00.000Z");

function sample(): ParsedUsage {
	return {
		valid: true,
		fetchedAtMs: FETCHED_AT_MS,
		windows: [
			{
				key: "rolling",
				label: "5h",
				usagePercent: 12,
				usageDollars: 1.44,
				limitDollars: 12,
				resetsAtMs: RESET_MS,
				resetInSec: 5 * 60 * 60,
				status: "ok",
			},
			{ key: "weekly", label: "week", usagePercent: 30, limitDollars: 30 },
			{ key: "monthly", label: "month", usagePercent: 25, limitDollars: 60 },
		],
	};
}

test("serialize/parse round-trips the full snapshot", () => {
	const raw = serializeUsageCache(sample(), "opencode-go");
	const parsed = parseUsageCache(raw);
	assert.ok(parsed);
	assert.equal(parsed.valid, true);
	assert.equal(parsed.fetchedAtMs, FETCHED_AT_MS);
	assert.equal(parsed.windows.length, 3);
	const rolling = parsed.windows[0]!;
	assert.equal(rolling.key, "rolling");
	assert.equal(rolling.label, "5h");
	assert.equal(rolling.usagePercent, 12);
	assert.equal(rolling.usageDollars, 1.44);
	assert.equal(rolling.limitDollars, 12);
	assert.equal(rolling.resetsAtMs, RESET_MS);
	assert.equal(rolling.resetInSec, 5 * 60 * 60);
	assert.equal(rolling.status, "ok");
});

test("optional fields survive round-trip as present or omitted", () => {
	const parsed = parseUsageCache(serializeUsageCache(sample(), "opencode-go"));
	const weekly = parsed!.windows[1]!;
	assert.equal(weekly.usagePercent, 30);
	assert.equal(weekly.usageDollars, undefined);
	assert.equal(weekly.resetsAtMs, undefined);
	assert.equal(weekly.status, undefined);
	// label falls back to key on read only when absent from the file.
	const monthly = parsed!.windows[2]!;
	assert.equal(monthly.label, "month");
});

test("rejects invalid JSON", () => {
	assert.equal(parseUsageCache("not json {{{"), undefined);
});

test("rejects a non-object root", () => {
	assert.equal(parseUsageCache("42"), undefined);
	assert.equal(parseUsageCache("[1,2,3]"), undefined);
});

test("rejects an unknown version", () => {
	const raw = serializeUsageCache(sample(), "opencode-go");
	assert.equal(parseUsageCache(raw.replace(/"version": 1/, '"version": 99')), undefined);
});

test("rejects a missing fetchedAtMs", () => {
	const raw = serializeUsageCache(sample(), "opencode-go");
	assert.equal(parseUsageCache(raw.replace(/"fetchedAtMs": [0-9]+,/, "")), undefined);
});

test("rejects when no window survives", () => {
	// windows with an unknown key and a non-numeric limit are both dropped.
	const raw = JSON.stringify({
		version: 1,
		fetchedAtMs: FETCHED_AT_MS,
		provider: "opencode-go",
		windows: [{ key: "bogus", label: "?", limitDollars: 10 }],
	});
	assert.equal(parseUsageCache(raw), undefined);
});

test("skips individual corrupt windows but keeps valid ones", () => {
	const raw = JSON.stringify({
		version: 1,
		fetchedAtMs: FETCHED_AT_MS,
		provider: "opencode-go",
		windows: [
			{ key: "rolling", label: "5h", usagePercent: 12, limitDollars: 12 },
			{ key: "weekly", label: 42 }, // not a record shape we accept (no limit)
			{ key: "monthly", label: "month", usagePercent: "oops", limitDollars: 60 },
		],
	});
	const parsed = parseUsageCache(raw);
	assert.ok(parsed);
	assert.equal(parsed.windows.length, 2);
	assert.deepEqual(
		parsed.windows.map((w) => w.key),
		["rolling", "monthly"],
	);
	assert.equal(parsed.windows[1]!.usagePercent, undefined);
});
