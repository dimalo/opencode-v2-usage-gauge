import { test } from "node:test";
import assert from "node:assert/strict";
import {
	barCells,
	barColorName,
	gaugeGeometry,
	layoutWidgetLine,
	monthlyWidgetLabel,
	weeklyWidgetLabel,
	windowParts,
	type WidgetLineLayout,
} from "../src/snapshot.ts";
import { parseUsageResponse, type UsageWindowState } from "../src/parser.ts";

// -------------------------------------------------------------------- barCells

test("barCells: degenerate inputs produce zero cells", () => {
	assert.equal(barCells(undefined, 10), 0);
	assert.equal(barCells(0, 10), 0);
	assert.equal(barCells(50, 0), 0);
	assert.equal(barCells(50, -3), 0);
});

test("barCells: rounds percent to cells and fills the whole bar at 100%", () => {
	assert.equal(barCells(19.5, 10), 2); // round(1.95)
	assert.equal(barCells(50, 10), 5);
	assert.equal(barCells(75, 10), 8); // round(7.5)
	assert.equal(barCells(100, 10), 10);
	assert.equal(barCells(124, 10), 10);
});

test("barCells: any positive usage gets at least one cell", () => {
	assert.equal(barCells(1, 10), 1);
	assert.equal(barCells(4, 10), 1);
	assert.equal(barCells(1, 100), 1);
});

test("barCells: small bars clamp correctly", () => {
	assert.equal(barCells(50, 1), 1);
	assert.equal(barCells(25, 3), 1); // round(0.75) → 1 via min-1
	assert.equal(barCells(50, 3), 2); // round(1.5)
});

// --------------------------------------------------------------- barColorName

test("barColorName: thresholds for warning/error", () => {
	assert.equal(barColorName(undefined), "accent");
	assert.equal(barColorName(10), "accent");
	assert.equal(barColorName(74), "accent");
	assert.equal(barColorName(75), "warning");
	assert.equal(barColorName(99.9), "warning");
	assert.equal(barColorName(100), "error");
	assert.equal(barColorName(124), "error");
});

// --------------------------------------------------------------- windowParts

test("windowParts: full window produces all parts", () => {
	const parsed = parseUsageResponse(
		{
			rolling5h: { usageDollars: 2.34, limitDollars: 12, usagePercent: 19.5, resetInSec: 7200 },
		},
		1_000_000,
	);
	const parts = windowParts(parsed.windows[0]!, 1_000_000);
	assert.equal(parts.pctText, "20%");
	assert.equal(parts.dollarsText, "$2.34/$12");
	assert.equal(parts.resetText, "2h 0m");
});

test("windowParts: percent-only window omits dollars and reset", () => {
	const parsed = parseUsageResponse({ usage: { weekly: { percent: 29 } } }, 1_000_000);
	const parts = windowParts(parsed.windows[0]!, 1_000_000);
	assert.equal(parts.pctText, "29%");
	assert.equal(parts.dollarsText, "");
	assert.equal(parts.resetText, "");
});

test("windowParts: missing percent shows --", () => {
	const parsed = parseUsageResponse({ usage: { monthly: { status: "ok", resetInSec: 990 } } }, 0);
	const parts = windowParts(parsed.windows[0]!, 0);
	assert.equal(parts.pctText, "--");
	assert.equal(parts.resetText, "17m"); // 990s ≈ 16.5 min, ceil'ed
});

// ------------------------------------------------- widget label derivation

test("weeklyWidgetLabel: short weekday of the weekly reset (local tz), wk fallback", () => {
	assert.equal(weeklyWidgetLabel(undefined), "wk");
	// Deterministic in every timezone: both sides resolve the SAME local date.
	const ms = Date.parse("2026-08-17T12:00:00.000Z");
	const expected = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(ms).getDay()];
	assert.equal(weeklyWidgetLabel(ms), expected);
	assert.match(weeklyWidgetLabel(ms), /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
});

test("monthlyWidgetLabel: days remaining as Nd with 1d floor, mo fallback", () => {
	const now = Date.parse("2026-08-16T12:00:00.000Z");
	assert.equal(monthlyWidgetLabel(undefined, now), "mo");
	assert.equal(monthlyWidgetLabel(now + 14.37 * 86_400_000, now), "15d"); // ceil
	assert.equal(monthlyWidgetLabel(now + 26 * 3_600_000, now), "2d");
	assert.equal(monthlyWidgetLabel(now + 12 * 3_600_000, now), "1d"); // ceil keeps 1d
	assert.equal(monthlyWidgetLabel(now - 86_400_000, now), "1d"); // clamp: never 0d
	assert.equal(monthlyWidgetLabel(now + 30.2 * 86_400_000, now), "31d");
});

// ------------------------------------------------------------ gaugeGeometry

test("gaugeGeometry: label trails below 50%, prefixes at 50%+", () => {
	assert.deepEqual(gaugeGeometry("12%", 12, 31), { divider: 4, labelStart: 5 });
	assert.deepEqual(gaugeGeometry("12%", 12, 6), { divider: 1, labelStart: 2 });
	assert.deepEqual(gaugeGeometry("60%", 60, 31), { divider: 19, labelStart: 16 });
	assert.deepEqual(gaugeGeometry("60%", 60, 6), { divider: 4, labelStart: 1 });
});

test("gaugeGeometry: 100%+ clamps the divider to the last cell", () => {
	assert.deepEqual(gaugeGeometry("100%", 100, 31), { divider: 30, labelStart: 26 });
	assert.deepEqual(gaugeGeometry("150%", 150, 31), { divider: 30, labelStart: 26 });
});

test("gaugeGeometry: 4-char percents reposition the divider instead of colliding", () => {
	// 50% in a 6-track: label prefixes at cell 0, divider moves after it.
	assert.deepEqual(gaugeGeometry("100%", 50, 6), { divider: 4, labelStart: 0 });
	// 33% in a 6-track: label trails at the end, divider backs up before it.
	assert.deepEqual(gaugeGeometry("100%", 33.33, 6), { divider: 1, labelStart: 2 });
	// Label never leaves the track in any case.
	for (const [pctText, pct] of [
		["12%", 12],
		["150%", 150],
		["--", undefined],
	] as [string, number | undefined][]) {
		const { divider, labelStart } = gaugeGeometry(pctText, pct, 6);
		assert.ok(labelStart >= 0 && labelStart + pctText.length <= 6, `${pctText} inside track`);
		assert.ok(divider >= 0 && divider < 6 && (divider < labelStart || divider >= labelStart + pctText.length));
	}
});

test("gaugeGeometry: missing percent renders -- trailing the start divider", () => {
	assert.deepEqual(gaugeGeometry("--", undefined, 31), { divider: 0, labelStart: 1 });
});

// ------------------------------------------------------------ layoutWidgetLine
// Fixed content for the standard windows (ALL widths measured, no padding):
// prefix "Go "=3, two " · "=6, labels 5h(2)+sp(1) + weekday(3)+sp(1) + 15d(3)+sp(1)
// → static = 20. Countdown " ⟳3h47m" = 7. Track width W = equal share of the
// remaining width (VARIABLE, recomputed every render), min MIN_GAUGE_WIDTH = 6.

const LAYOUT_NOW = Date.parse("2026-08-16T12:00:00.000Z");
const LAYOUT_RESET_ISO = "2026-08-16T15:47:00.000Z"; // 3h47m after LAYOUT_NOW → "3h47m"
const LAYOUT_MONTHLY_RESET = "2026-08-30T20:48:00.000Z"; // ≈14.37d after LAYOUT_NOW → "15d"

function threeWindows(): UsageWindowState[] {
	const parsed = parseUsageResponse(
		{
			usage: {
				rolling: { percent: 12, resetsAt: LAYOUT_RESET_ISO },
				weekly: { percent: 24, resetsAt: LAYOUT_RESET_ISO },
				monthly: { percent: 12, resetsAt: LAYOUT_MONTHLY_RESET },
			},
		},
		LAYOUT_NOW,
	);
	return parsed.windows;
}

function assertSegments(layout: WidgetLineLayout, widths: number[], dividers: number[], labelStarts: number[]) {
	assert.deepEqual(
		layout.segments.map((s) => s.gaugeWidth),
		widths,
	);
	assert.deepEqual(layout.segments.map((s) => s.divider), dividers);
	assert.deepEqual(layout.segments.map((s) => s.labelStart), labelStarts);
}

test("layoutWidgetLine: labels are derived, widths measured (5h/Mon/15d)", () => {
	const layout = layoutWidgetLine(threeWindows(), LAYOUT_NOW, 120);
	assert.deepEqual(layout.segments.map((s) => s.label), [
		"5h",
		weeklyWidgetLabel(Date.parse(LAYOUT_RESET_ISO)),
		"15d",
	]);
	assert.equal(layout.segments[0]!.countdown, "3h47m"); // rolling only
	assert.equal(layout.segments[1]!.countdown, undefined);
});

test("layoutWidgetLine: variable track grows to the full width (equal split)", () => {
	const layout = layoutWidgetLine(threeWindows(), LAYOUT_NOW, 120);
	assert.equal(layout.showCountdown, true);
	assertSegments(layout, [31, 31, 31], [4, 7, 4], [5, 8, 5]); // floor((120−20−7)/3)
});

test("layoutWidgetLine: min track with countdown fits at exactly 45 cells", () => {
	const layout = layoutWidgetLine(threeWindows(), LAYOUT_NOW, 45); // 20+7+18
	assert.equal(layout.showCountdown, true);
	assertSegments(layout, [6, 6, 6], [1, 1, 1], [2, 2, 2]);
});

test("layoutWidgetLine: countdown drops before the track (44 cells)", () => {
	const layout = layoutWidgetLine(threeWindows(), LAYOUT_NOW, 44);
	assert.equal(layout.showCountdown, false);
	assertSegments(layout, [8, 8, 8], [1, 2, 1], [2, 3, 2]); // floor((44−20)/3)
});

test("layoutWidgetLine: min track without countdown at exactly 38 cells", () => {
	const layout = layoutWidgetLine(threeWindows(), LAYOUT_NOW, 38); // 20+18
	assert.equal(layout.showCountdown, false);
	assertSegments(layout, [6, 6, 6], [1, 1, 1], [2, 2, 2]);
});

test("layoutWidgetLine: below the 3-segment budget the tail is dropped (37 cells)", () => {
	// 3 segments need 20+18 = 38 cells. At 37 the monthly window is dropped
	// (rolling survives) instead of overflowing the row.
	const layout = layoutWidgetLine(threeWindows(), LAYOUT_NOW, 37);
	assert.equal(layout.segments.length, 2);
	assertSegments(layout, [8, 8], [1, 2], [2, 3]);
});

test("layoutWidgetLine: always keeps at least the rolling window", () => {
	for (const width of [12, 16, 20, 24]) {
		const layout = layoutWidgetLine(threeWindows(), LAYOUT_NOW, width);
		assert.equal(layout.segments.length, 1, `width ${width}`);
		assert.equal(layout.segments[0]!.label, "5h", `width ${width}`);
	}
});

test("layoutWidgetLine: showCountdown=false gives the track the full width", () => {
	const layout = layoutWidgetLine(threeWindows(), LAYOUT_NOW, 120, false);
	assert.equal(layout.showCountdown, false);
	assertSegments(layout, [33, 33, 33], [4, 8, 4], [5, 9, 5]); // floor((120−20)/3)
	assert.equal(layout.segments[0]!.countdown, undefined);
});

test("layoutWidgetLine: label flips to prefixed form at 50%+; 100% clamps to the end", () => {
	const parsed = parseUsageResponse(
		{
			usage: {
				rolling: { percent: 60, resetsAt: LAYOUT_RESET_ISO },
				weekly: { percent: 100, resetsAt: LAYOUT_RESET_ISO },
				monthly: { percent: 49, resetsAt: LAYOUT_MONTHLY_RESET },
			},
		},
		LAYOUT_NOW,
	);
	const layout = layoutWidgetLine(parsed.windows, LAYOUT_NOW, 120); // W=31
	assertSegments(layout, [31, 31, 31], [19, 30, 15], [16, 26, 16]);
	assert.equal(layout.segments[1]!.pctText, "100%"); // 4-char percent handled
});

test("layoutWidgetLine: no rolling reset → no countdown even with other windows set", () => {
	const parsed = parseUsageResponse(
		{
			usage: {
				rolling: { percent: 50 },
				weekly: { percent: 24, resetsAt: LAYOUT_RESET_ISO },
				monthly: { percent: 12, resetsAt: LAYOUT_MONTHLY_RESET },
			},
		},
		LAYOUT_NOW,
	);
	const layout = layoutWidgetLine(parsed.windows, LAYOUT_NOW, 120);
	assert.equal(layout.showCountdown, false);
	assertSegments(layout, [33, 33, 33], [17, 8, 4], [14, 9, 5]); // 50% of 33 prefixes
});

test("layoutWidgetLine: long countdown 4d3h widens the fixed content (measured)", () => {
	const longReset = "2026-08-20T15:00:00.000Z"; // 99h = 4d3h after LAYOUT_NOW
	const parsed = parseUsageResponse(
		{
			usage: {
				rolling: { percent: 12, resetsAt: longReset },
				weekly: { percent: 24, resetsAt: LAYOUT_RESET_ISO },
				monthly: { percent: 12, resetsAt: LAYOUT_MONTHLY_RESET },
			},
		},
		LAYOUT_NOW,
	);
	const layout = layoutWidgetLine(parsed.windows, LAYOUT_NOW, 100);
	assert.equal(layout.segments[0]!.countdown, "4d3h");
	assertSegments(layout, [24, 24, 24], [3, 6, 3], [4, 7, 4]); // 20+6+72 = 98 ≤ 100
});

test("layoutWidgetLine: label fallbacks widen the track (wk = 2 cells)", () => {
	const parsed = parseUsageResponse(
		{
			usage: {
				rolling: { percent: 12, resetsAt: LAYOUT_RESET_ISO },
				weekly: { percent: 24 }, // no resetsAt → "wk"
				monthly: { percent: 12, resetsAt: LAYOUT_MONTHLY_RESET },
			},
		},
		LAYOUT_NOW,
	);
	const layout = layoutWidgetLine(parsed.windows, LAYOUT_NOW, 100);
	assert.equal(layout.segments[1]!.label, "wk");
	assertSegments(layout, [24, 24, 24], [3, 6, 3], [4, 7, 4]); // static 19: floor((100−19−7)/3)
});

test("layoutWidgetLine: -- percents overlay in the empty track (no resets, no cd)", () => {
	const parsed = parseUsageResponse(
		{ usage: { rolling: { status: "ok" }, weekly: { status: "ok" }, monthly: { status: "ok" } } },
		LAYOUT_NOW,
	);
	const layout = layoutWidgetLine(parsed.windows, LAYOUT_NOW, 100);
	assert.equal(layout.showCountdown, false);
	assertSegments(layout, [27, 27, 27], [0, 0, 0], [1, 1, 1]); // static 18, f=0
	assert.equal(layout.segments[0]!.pctText, "--");
});

test("layoutWidgetLine: empty windows produce an empty layout", () => {
	assert.deepEqual(layoutWidgetLine([], LAYOUT_NOW, 100), { segments: [], showCountdown: false });
});
test("layoutWidgetLine never exceeds the width budget", () => {
	const windows: UsageWindowState[] = [
		{ key: "rolling", label: "5h", usagePercent: 8, limitDollars: 12, resetsAtMs: 1_800_000_000_000 },
		{ key: "weekly", label: "week", usagePercent: 44, limitDollars: 30, resetsAtMs: 1_800_000_000_000 },
		{ key: "monthly", label: "month", usagePercent: 43, limitDollars: 60, resetsAtMs: 1_800_000_000_000 },
	];
	const rendered = (layout: ReturnType<typeof layoutWidgetLine>) =>
		3 +
		layout.segments.reduce(
			(acc, segment, i) =>
				acc +
				(i > 0 ? 3 : 0) +
				segment.label.length +
				1 +
				segment.gaugeWidth +
				(segment.countdown !== undefined ? 2 + segment.countdown.length : 0),
			0,
		);
	// Narrow budgets drop trailing windows (rolling survives) rather than wrap.
	for (const width of [40, 48, 56, 64, 80, 120, 200]) {
		const layout = layoutWidgetLine(windows, Date.now(), width, true);
		assert.ok(layout.segments.length >= 1, `no segments at ${width}`);
		assert.ok(rendered(layout) <= width, `overflow at ${width}: ${rendered(layout)}`);
	}
	// Generous width keeps all three windows.
	assert.equal(layoutWidgetLine(windows, Date.now(), 200, true).segments.length, 3);
});

test("layoutWidgetLine: the provider tag width is measured, not assumed", () => {
	// "Go " is the historical default (3 cells) and must stay byte-identical.
	// Countdown off, so the track gets the full remainder: floor((120-20)/3).
	const base = layoutWidgetLine(threeWindows(), LAYOUT_NOW, 120, false);
	assert.equal(base.segments[0]!.gaugeWidth, 33);
	// A wider tag takes its cells out of the tracks instead of overflowing:
	// static content grows 3 → 7, so floor((120-24)/3) = 32 per window.
	const wide = layoutWidgetLine(threeWindows(), LAYOUT_NOW, 120, false, 7);
	assert.equal(wide.segments[0]!.gaugeWidth, 32);
	// ...and a narrower one gives them back.
	const narrow = layoutWidgetLine(threeWindows(), LAYOUT_NOW, 120, false, 2);
	assert.equal(narrow.segments[0]!.gaugeWidth, 33);
	assert.equal(narrow.segments[0]!.gaugeWidth - base.segments[0]!.gaugeWidth, 0);
	// The rendered line never exceeds the budget for any tag width.
	for (const prefixWidth of [1, 3, 4, 10]) {
		const layout = layoutWidgetLine(threeWindows(), LAYOUT_NOW, 60, true, prefixWidth);
		const rendered =
			prefixWidth +
			layout.segments.reduce(
				(acc, segment, i) =>
					acc + (i > 0 ? 3 : 0) + segment.label.length + 1 + segment.gaugeWidth,
				0,
			);
		assert.ok(rendered <= 60, `overflow with prefix ${prefixWidth}: ${rendered}`);
	}
});
