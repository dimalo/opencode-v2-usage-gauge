/**
 * Pure, dependency-free helpers for the `/usage` chat-entry snapshot and the
 * single-line widget layout.
 *
 * Kept separate from the renderer/command wiring so the layout math (bar cell
 * counts, color thresholds, responsive width allocation, per-window text
 * parts) is unit-testable without a TUI.
 */

import {
	formatDollars,
	formatPercent,
	formatResetDuration,
	formatResetDurationCompact,
	type UsageWindowState,
} from "./parser.ts";
import { visibleWidth } from "./ansi.ts";

/** Data stored in each `opencode-go-usage-snapshot` custom entry. */
export interface SnapshotData {
	/** Per-window numbers at fetch time (empty when `error` is set). */
	windows: UsageWindowState[];
	/** Epoch ms when the fetch that produced this data happened. */
	fetchedAtMs: number;
	/** Provider the key was resolved for (always "opencode-go" for /usage). */
	provider: string;
	/** True when the snapshot shows previously-fetched data. */
	stale: boolean;
	/** Human-readable failure reason; set instead of `windows` on the error path. */
	error?: string;
}

export type BarColorName = "accent" | "warning" | "error";

/**
 * Number of filled bar cells for a percentage and target bar width.
 * Degenerate inputs map to 0; any positive usage gets at least one cell;
 * >=100% fills the whole bar.
 */
export function barCells(percent: number | undefined, barWidth: number): number {
	if (barWidth <= 0) return 0;
	const pct = percent ?? 0;
	if (pct <= 0) return 0;
	if (pct >= 100) return barWidth;
	return Math.max(1, Math.min(barWidth, Math.round((pct / 100) * barWidth)));
}

/** Bar color by usage: normal → accent, >=75% → warning, >=100% → error. */
export function barColorName(percent: number | undefined): BarColorName {
	const pct = percent ?? 0;
	if (pct >= 100) return "error";
	if (pct >= 75) return "warning";
	return "accent";
}

/** The static text parts rendered after the bar on a window line. */
export interface WindowParts {
	pctText: string;
	dollarsText: string;
	resetText: string;
}

export function windowParts(window: UsageWindowState, nowMs: number): WindowParts {
	return {
		pctText: window.usagePercent !== undefined ? formatPercent(window.usagePercent) : "--",
		dollarsText:
			window.usageDollars !== undefined
				? `${formatDollars(window.usageDollars)}/${formatDollars(window.limitDollars)}`
				: "",
		resetText: window.resetsAtMs !== undefined ? formatResetDuration(window.resetsAtMs, nowMs) : "",
	};
}

// ------------------------------------------------------------- single line

/**
 * Weekly widget label: the short WEEKDAY the weekly window rolls over on
 * (local timezone), derived from its resetsAtMs — e.g. "Mon". Falls back to
 * "wk" when resetsAtMs is absent. All short weekday names are 3 cells.
 */
export function weeklyWidgetLabel(resetsAtMs: number | undefined): string {
	if (resetsAtMs === undefined) return "wk";
	return new Date(resetsAtMs).toLocaleDateString("en-US", { weekday: "short" });
}

/**
 * Monthly widget label: days remaining until the monthly reset as "Nd"
 * (e.g. "14d"), derived from its resetsAtMs; a still-future reset never
 * shows "0d" (min "1d"). Falls back to "mo" when resetsAtMs is absent.
 * Always ≤ 3 cells for realistic month lengths.
 */
export function monthlyWidgetLabel(resetsAtMs: number | undefined, nowMs: number): string {
	if (resetsAtMs === undefined) return "mo";
	const days = Math.ceil((resetsAtMs - nowMs) / 86_400_000);
	return `${Math.max(1, days)}d`;
}

function widgetLabel(window: UsageWindowState, nowMs: number): string {
	switch (window.key) {
		case "weekly":
			return weeklyWidgetLabel(window.resetsAtMs);
		case "monthly":
			return monthlyWidgetLabel(window.resetsAtMs, nowMs);
		default:
			return "5h"; // rolling
	}
}

/**
 * Track width floor for the gauge. 6 is the smallest width where both label
 * forms fit without clamping for all fills: trailing (percent < 50) puts the
 * 3-cell label right after the divider (needs d ≤ width−4 with
 * d ≤ ceil(width/2)−1 → width ≥ 6); prefixing (percent ≥ 50) needs
 * d ≥ 3 → width ≥ 6.
 */
export const MIN_GAUGE_WIDTH = 6;
const PREFIX_WIDTH = 3; // "Go "
const SEGMENT_SEPARATOR_WIDTH = 3; // " · "

/** One segment of the single-line gauge widget. */
export interface WidgetSegment {
	/** Variable-width: "5h" (2), short weekday "Mon" (3), "14d" (3), fallbacks 2. */
	label: string;
	/** Threshold color (accent <75 / warning 75–99 / error ≥100) for the percent text. */
	color: BarColorName;
	pctText: string;
	/** Variable track width in cells (equal share of the available width). */
	gaugeWidth: number;
	/** Cell index of the "│" divider (always within [0, gaugeWidth), replaces a track cell). */
	divider: number;
	/** First cell of the percent label (label is guaranteed ⊆ [0, gaugeWidth)). */
	labelStart: number;
	/** Compact no-space countdown ("3h47m") — only ever set on the rolling window. */
	countdown?: string;
}

export interface WidgetLineLayout {
	segments: WidgetSegment[];
	/** True when the ⟳ countdown is included on the rolling segment. */
	showCountdown: boolean;
}

/**
 * Gauge cell geometry for one segment, computed from the VARIABLE track
 * width `width` (measured in cells):
 *   - fill fraction f = clamp(percent/100, 0, 1); divider index
 *     d = round(f · width), clamped to [0, width−1];
 *   - percent < 50 → label TRAILS the divider (`│12%`); percent ≥ 50 → it
 *     PREFIXES the divider (`60%│`) — keeps the label inside the track at
 *     both extremes;
 *   - label + divider clamp/reposition so the label never leaves the track
 *     (also for 4-cell percents like "100%" / "150%");
 *   - the divider occupies a real cell: the track is exactly `width` cells
 *     wide (divider REPLACES a track cell, it is not additive).
 */
export function gaugeGeometry(
	pctText: string,
	percent: number | undefined,
	width: number,
): { divider: number; labelStart: number } {
	const pctLen = visibleWidth(pctText);
	if (width <= 0) return { divider: 0, labelStart: 0 };
	const f = percent === undefined ? 0 : Math.min(1, Math.max(0, percent / 100));
	const d = Math.min(width - 1, Math.max(0, Math.round(f * width)));
	const trail = f < 0.5;
	const labelStart = trail
		? Math.min(d + 1, width - pctLen)
		: Math.max(0, Math.min(d - pctLen, width - pctLen));
	let divider = d;
	// Percent texts wider than 3 cells can overlap the divider after clamping
	// → move the divider to the nearest free cell (rare: only tiny tracks with
	// "100%"-style percents).
	if (divider >= labelStart && divider < labelStart + pctLen) {
		const after = labelStart + pctLen;
		divider = after <= width - 1 ? after : Math.max(0, labelStart - 1);
	}
	return { divider, labelStart };
}

/**
 * Responsive layout for the single-line widget (pure-ASCII gauge):
 *
 *   `Go  5h ════│12%────── ⟳3h47m · Mon ═══════24%│─── · 14d ════│12%──────`
 *
 * =════ filled (dim) · ───── unfilled track (dim) · │ divider (text) ·
 * percent label in the threshold fg color, flipped to trail the divider under
 * 50% and prefix it at 50%+. The TRACK WIDTH is VARIABLE: computed afresh
 * from the terminal width on every render, split equally across the windows
 * after reserving variable-width fixed content (prefix, separators, labels,
 * countdown — measured with visibleWidth, no fixed/padded widths). When the
 * line does not fit: 1) drop the ⟳ countdown, 2) shrink the track to
 * MIN_GAUGE_WIDTH, 3) the caller falls back to truncateToWidth.
 */
export function layoutWidgetLine(
	windows: UsageWindowState[],
	nowMs: number,
	width: number,
	showCountdown = true,
): WidgetLineLayout {
	const n = windows.length;
	if (n === 0) return { segments: [], showCountdown: false };

	const base = windows.map((window) => {
		const pctText =
			window.usagePercent !== undefined ? formatPercent(window.usagePercent) : "--";
		return {
			percent: window.usagePercent,
			pctText,
			label: widgetLabel(window, nowMs),
			color: barColorName(window.usagePercent),
			countdown:
				showCountdown && window.key === "rolling" && window.resetsAtMs !== undefined
					? formatResetDurationCompact(window.resetsAtMs, nowMs)
					: undefined,
		};
	});

	const countdownText = base.find((segment) => segment.countdown !== undefined)?.countdown;
	const countdownW = countdownText !== undefined ? 1 + 1 + visibleWidth(countdownText) : 0; // " ⟳" + duration

	// Fixed content for the first `count` segments, all measured (labels 2–3
	// cells, countdown variable). Segments are dropped from the tail when the
	// budget is too small, so the returned line ALWAYS fits `width` (the
	// rolling window is kept — it is the one that changes fastest).
	const staticWidth = (count: number) =>
		PREFIX_WIDTH +
		SEGMENT_SEPARATOR_WIDTH * Math.max(0, count - 1) +
		base
			.slice(0, count)
			.reduce((acc, segment) => acc + visibleWidth(segment.label) + 1, 0);

	let count = n;
	while (count > 1 && staticWidth(count) + count * MIN_GAUGE_WIDTH > width) count--;

	const staticW = staticWidth(count);

	let gaugeWidth: number;
	let showCd = false;
	if (countdownW > 0 && staticW + countdownW + count * MIN_GAUGE_WIDTH <= width) {
		gaugeWidth = Math.floor((width - staticW - countdownW) / count);
		showCd = true;
	} else if (staticW + count * MIN_GAUGE_WIDTH <= width) {
		gaugeWidth = Math.floor((width - staticW) / count);
	} else {
		// Last resort: minimum track. With count === 1 this always fits, since
		// the budget floor is wider than label + prefix + MIN_GAUGE_WIDTH.
		gaugeWidth = MIN_GAUGE_WIDTH;
	}

	return {
		showCountdown: showCd,
		segments: base.slice(0, count).map((segment) => {
			const geometry = gaugeGeometry(segment.pctText, segment.percent, gaugeWidth);
			return {
				label: segment.label,
				color: segment.color,
				pctText: segment.pctText,
				gaugeWidth,
				divider: geometry.divider,
				labelStart: geometry.labelStart,
				countdown: showCd ? segment.countdown : undefined,
			};
		}),
	};
}