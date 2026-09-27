import { test } from "node:test";
import assert from "node:assert/strict";
import {
	DEFAULT_LIMIT_DOLLARS,
	formatDollars,
	formatPercent,
	formatResetDuration,
	formatResetDurationCompact,
	parseUsageResponse,
} from "../src/parser.ts";

const NOW = Date.parse("2026-08-16T12:00:00.000Z");
const RESET_ISO = "2026-08-16T17:30:00.000Z";

// ---------------------------------------------------------------- canonical

test("parses the canonical {usage:{...}} shape with percent + resetsAt", () => {
	const parsed = parseUsageResponse(
		{
			usage: {
				rolling: { status: "ok", percent: 4, resetsAt: RESET_ISO },
				weekly: { status: "ok", percent: 30, resetsAt: RESET_ISO },
				monthly: { status: "ok", percent: 25, resetsAt: RESET_ISO },
			},
		},
		NOW,
	);
	assert.equal(parsed.valid, true);
	assert.deepEqual(
		parsed.windows.map((w) => w.key),
		["rolling", "weekly", "monthly"],
	);
	const rolling = parsed.windows[0]!;
	const weekly = parsed.windows[1]!;
	const monthly = parsed.windows[2]!;
	assert.equal(rolling.usagePercent, 4);
	assert.equal(rolling.resetsAtMs, Date.parse(RESET_ISO));
	assert.equal(rolling.status, "ok");
	assert.equal(weekly.usagePercent, 30);
	assert.equal(monthly.usagePercent, 25);
	// Documented fallback limits when the API omits limitDollars.
	assert.equal(rolling.limitDollars, 12);
	assert.equal(weekly.limitDollars, 30);
	assert.equal(monthly.limitDollars, 60);
	// resetInSec derived from resetsAt for the countdown.
	assert.equal(rolling.resetInSec, (Date.parse(RESET_ISO) - NOW) / 1000);
});

test("parses the alt shape with usageDollars/limitDollars/usagePercent/resetInSec at top level", () => {
	const parsed = parseUsageResponse(
		{
			rolling5h: { usageDollars: 2.34, limitDollars: 12, usagePercent: 19.5, resetInSec: 7200 },
			weekly: { usageDollars: 8.91, limitDollars: 30, usagePercent: 29.7, resetInSec: 345600 },
			monthly: { usageDollars: 15, limitDollars: 60, usagePercent: 25, resetInSec: 1414800 },
			subscribedAt: "2026-05-22T14:30:00Z",
		},
		NOW,
	);
	assert.equal(parsed.valid, true);
	const rolling = parsed.windows[0]!;
	const weekly = parsed.windows[1]!;
	const monthly = parsed.windows[2]!;
	assert.equal(rolling.key, "rolling");
	assert.equal(rolling.usageDollars, 2.34);
	assert.equal(rolling.limitDollars, 12);
	assert.equal(rolling.usagePercent, 19.5);
	assert.equal(rolling.resetInSec, 7200);
	assert.equal(rolling.resetsAtMs, NOW + 7200 * 1000);
	assert.equal(weekly.limitDollars, 30);
	assert.equal(monthly.limitDollars, 60);
});

test("parses windows nested under a {windows: {...}} container", () => {
	const parsed = parseUsageResponse(
		{
			windows: {
				rolling: { percent: 10, resetInSec: 600 },
				weekly: { percent: 20, resetInSec: 1200 },
				monthly: { percent: 30, resetInSec: 1800 },
			},
		},
		NOW,
	);
	assert.equal(parsed.valid, true);
	assert.equal(parsed.windows.length, 3);
});

test("accepts snake_case field aliases and the 5h rolling alias", () => {
	const parsed = parseUsageResponse(
		{
			"5h": { usage_percent: 11, reset_in_sec: 99 },
			weekly: { usage_percent: 22, reset_in_sec: 199 },
			monthly: { usage_percent: 33, reset_in_sec: 299 },
		},
		NOW,
	);
	const rolling = parsed.windows[0]!;
	const weekly = parsed.windows[1]!;
	const monthly = parsed.windows[2]!;
	assert.equal(rolling.usagePercent, 11);
	assert.equal(weekly.usagePercent, 22);
	assert.equal(monthly.usagePercent, 33);
});

test("derives percent from usageDollars/limitDollars when percent is missing", () => {
	const parsed = parseUsageResponse(
		{
			usage: {
				rolling: { usageDollars: 6, limitDollars: 12 },
				weekly: { usageDollars: 9 },
				monthly: {},
			},
		},
		NOW,
	);
	const rolling = parsed.windows[0]!;
	const weekly = parsed.windows[1]!;
	assert.equal(rolling.usagePercent, 50);
	assert.equal(weekly.usagePercent, 30); // 9/30 default limit
	assert.equal(weekly.limitDollars, 30);
	// A window object with no usable fields at all is omitted (graceful degradation).
	assert.equal(parsed.windows.find((w) => w.key === "monthly"), undefined);
});

// ------------------------------------------------------------------ leniency

test("returns valid=false for unparseable payloads", () => {
	for (const garbage of [null, undefined, 42, "nope", [], { hello: "world" }]) {
		const parsed = parseUsageResponse(garbage, NOW);
		assert.equal(parsed.valid, false, JSON.stringify(garbage));
		assert.deepEqual(parsed.windows, []);
	}
});

test("tolerates partially missing windows", () => {
	const parsed = parseUsageResponse({ usage: { monthly: { percent: 42 } } }, NOW);
	assert.equal(parsed.valid, true);
	assert.equal(parsed.windows.length, 1);
	assert.equal(parsed.windows[0]?.key, "monthly");
});

test("keeps over-100 percentages intact", () => {
	const parsed = parseUsageResponse({ usage: { rolling: { percent: 124 } } }, NOW);
	assert.equal(parsed.windows[0]?.usagePercent, 124);
});

test("accepts numeric strings", () => {
	const parsed = parseUsageResponse(
		{ usage: { rolling: { percent: "12.5", resetInSec: "7200" } } },
		NOW,
	);
	assert.equal(parsed.windows[0]?.usagePercent, 12.5);
	assert.equal(parsed.windows[0]?.resetInSec, 7200);
});

test("handles resetsAt as epoch milliseconds", () => {
	const parsed = parseUsageResponse(
		{ usage: { rolling: { percent: 1, resetsAt: Date.parse(RESET_ISO) } } },
		NOW,
	);
	assert.equal(parsed.windows[0]?.resetsAtMs, Date.parse(RESET_ISO));
});

test("treats a window object with no usable fields as absent", () => {
	const parsed = parseUsageResponse({ usage: { rolling: { note: "hello" } } }, NOW);
	assert.equal(parsed.valid, false);
});

// ----------------------------------------------------------------- formatters

test("formatResetDuration covers all ranges at minute granularity", () => {
	assert.equal(formatResetDuration(NOW + 90_000, NOW), "2m");
	assert.equal(formatResetDuration(NOW + 45_000, NOW), "1m"); // ceil: 45s → "1m"
	assert.equal(formatResetDuration(NOW + 62_000, NOW), "2m");
	assert.equal(formatResetDuration(NOW + 7_200_000, NOW), "2h 0m");
	assert.equal(formatResetDuration(NOW + 9_000_000, NOW), "2h 30m");
	assert.equal(formatResetDuration(NOW + 3.5 * 86400_000, NOW), "3d 12h");
	assert.equal(formatResetDuration(NOW + 16.4 * 86400_000, NOW), "16d 9h");
	assert.equal(formatResetDuration(NOW - 1000, NOW), "0m"); // already reset
});

test("formatDollars shows two decimals, trimming trailing .00", () => {
	assert.equal(formatDollars(2.34), "$2.34");
	assert.equal(formatDollars(12), "$12");
	assert.equal(formatDollars(0), "$0");
	assert.equal(formatDollars(15), "$15");
});

test("formatPercent rounds to integers", () => {
	assert.equal(formatPercent(19.4), "19%");
	assert.equal(formatPercent(19.6), "20%");
	assert.equal(formatPercent(124), "124%");
});

test("documented default limits are exposed for the UI", () => {
	assert.deepEqual(DEFAULT_LIMIT_DOLLARS, { rolling: 12, weekly: 30, monthly: 60 });
});

test("formatResetDurationCompact strips spaces from the spaced form", () => {
	assert.equal(formatResetDurationCompact(NOW + 227 * 60_000, NOW), "3h47m");
	assert.equal(formatResetDurationCompact(NOW + 45_000, NOW), "1m");
	assert.equal(formatResetDurationCompact(NOW + 120 * 60_000, NOW), "2h0m");
	assert.equal(formatResetDurationCompact(NOW + (4 * 1440 + 3 * 60) * 60_000, NOW), "4d3h");
	assert.equal(formatResetDurationCompact(NOW - 1000, NOW), "0m");
});