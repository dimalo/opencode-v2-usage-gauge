/**
 * opencode-go-usage — TUI (CLI plugin) entry.
 *
 * Shows OpenCode Go subscription usage in the OpenCode V2 terminal UI —
 * **only while an `opencode-go` model is selected** — as a single-line ASCII
 * gauge appended to the `prompt.footer.status` slot, plus a `/usage` slash
 * command that shows the full three-window snapshot in a dialog (and
 * refreshes the widget).
 *
 *     Go  5h ════│12%────── ⟳3h47m · Mon ═══════24%│─── · 14d ════│12%──────
 *
 * Data source: official usage endpoint `GET https://opencode.ai/zen/go/v1/usage`
 * (Bearer auth, live since 2026-08-11, upstream PR anomalyco/opencode#16513).
 * The API key is resolved at runtime from OpenCode's own auth store
 * (`auth.json`, see src/auth.ts) and is never logged, printed, or persisted.
 *
 * Scope note: no zen/credit-balance display — Go plan windows only; the
 * widget hides for every non-`opencode-go` provider. May be extended later.
 */

import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { For, Show, createMemo, createSignal } from "solid-js";
import { onCleanup, onMount } from "solid-js";
import { DEFAULT_CONFIG, parseGoUsageConfig, type GoUsageConfig } from "./config.ts";
import type { ParsedUsage } from "./parser.ts";
import { readApiKeyFromAuthStore } from "./auth.ts";
import { CACHE_TTL_MS, TARGET_PROVIDER, guardedFetch, type FetchOutcome } from "./usage.ts";
import {
	barCells,
	barColorName,
	layoutWidgetLine,
	windowParts,
	type WidgetSegment,
} from "./snapshot.ts";

// ------------------------------------------------------------------ helpers

/** Widget colors map to live theme tokens at render time (never baked). */
type ColorKind = "dim" | "base" | "accent" | "warning" | "error";

interface GaugeSpan {
	text: string;
	color: ColorKind;
}

/**
 * One gauge segment as an ordered span list (OpenTUI renders each `<text>`
 * with its own `fg` token):
 *   `{label} {gauge}` — track cells are `═` filled / `─` unfilled (dim),
 *   `│` divider (base), percent label in the threshold color, flipped to
 *   trail the divider below 50% and prefix it at 50%+.
 */
function buildGaugeSpans(segment: WidgetSegment): GaugeSpan[] {
	const { pctText, color, gaugeWidth, divider, labelStart } = segment;
	const pctColor: ColorKind = pctText === "--" ? "dim" : color;
	const spans: GaugeSpan[] = [];
	let current: ColorKind | undefined;
	let buffer = "";
	const push = () => {
		if (buffer !== "" && current !== undefined) spans.push({ text: buffer, color: current });
	};
	for (let i = 0; i < gaugeWidth; i++) {
		const labelIndex = i - labelStart;
		let kind: ColorKind;
		let ch: string;
		if (labelIndex >= 0 && labelIndex < pctText.length) {
			kind = pctColor;
			ch = pctText[labelIndex]!;
		} else if (i === divider) {
			kind = "base";
			ch = "│";
		} else {
			kind = "dim";
			ch = i < divider ? "═" : "─";
		}
		if (kind !== current) {
			push();
			current = kind;
			buffer = ch;
		} else {
			buffer += ch;
		}
	}
	push();
	return spans;
}

/** Layout "multi": title + one line per window (label, fixed 10-cell bar, pct, reset). */
// (renderMultiLines below implements this in JSX)

// --------------------------------------------------------------------- state

const inflight: { value: Promise<FetchOutcome> | undefined } = { value: undefined };

interface GoUsageCache {
	fetchedAtMs: number;
	data: ParsedUsage;
}

/**
 * Shared module-level snapshot (Signal at module scope is safe in Solid —
 * only computeds need ownership). The widget and the /usage command read and
 * update the same state, so a /usage fetch immediately refreshes the widget.
 */
const [shared, setShared] = createSignal<GoUsageCache | undefined>(undefined);
const [sharedStale, setSharedStale] = createSignal(false);
/** Human-readable reason of the last failed fetch, cleared on success. */
let lastError: string | undefined = undefined;

function applyOutcome(outcome: FetchOutcome): void {
	if (outcome.ok) {
		setShared({ data: outcome.data, fetchedAtMs: outcome.data.fetchedAtMs });
		setSharedStale(false);
		lastError = undefined;
	} else {
		lastError = outcome.error;
		if (outcome.kind === "no-key" || outcome.kind === "unauthorized") {
			// No plan / key rejected → hide the widget entirely.
			setShared(undefined);
			setSharedStale(false);
		} else {
			// Transient failure: keep previous data visible, marked stale.
			setSharedStale(true);
		}
	}
}

/** Fetch (single-flight, shared with the /usage command) and apply the outcome. */
async function refresh(): Promise<void> {
	const outcome = await guardedFetch(async () => readApiKeyFromAuthStore(), inflight);
	applyOutcome(outcome);
}

// ------------------------------------------------------------------ component

function UsageWidget(props: { config: GoUsageConfig }) {
	const context = usePlugin();
	const [now, setNow] = createSignal(Date.now());
	const cache = shared;

	onMount(() => {
		void (async () => {
			const current = cache();
			if (current !== undefined && Date.now() - current.fetchedAtMs < CACHE_TTL_MS) return;
			await refresh(); // single-flight; the ticker and /usage share this too
		})();
		const ticker = setInterval(() => {
			try {
				const current = cache();
				if (current === undefined || Date.now() - current.fetchedAtMs >= CACHE_TTL_MS) {
					void refresh(); // fire-and-forget; single-flight guard prevents overlap
				}
				setNow(Date.now()); // minute-granularity countdown re-render
			} catch {
				// Never crash the TUI from a tick.
			}
		}, 60_000);
		onCleanup(() => clearInterval(ticker));
	});

	// ---------------------------------------------------------------- visibility

	const visible = createMemo(
		() => context.ui.model.current()?.providerID === TARGET_PROVIDER && cache() !== undefined,
	);

	const data = () => cache()!.data;

	// Widget geometry source. The prompt footer is a SHARED row — the built-in
	// cost/hint items render next to the claim, so budgeting the full terminal
	// width overflows and wraps. Take at most half the row (floor keeps the
	// line fitting even on a tiny terminal), or whatever `maxWidth` allows.
	const width = () => {
		const full = Math.max(40, context.renderer.width);
		const explicit = props.config.maxWidth;
		if (explicit > 0) return Math.min(full, explicit);
		return Math.max(48, Math.min(full, Math.floor(full / 2)));
	};

	// --------------------------------------------------------------- rendering

	const color = (kind: ColorKind) => {
		const theme = context.theme;
		switch (kind) {
			case "dim":
				return theme.text.muted;
			case "accent":
				return theme.text.feedback.info.base;
			case "warning":
				return theme.text.feedback.warning.base;
			case "error":
				return theme.text.feedback.error.base;
			default:
				return theme.text.base;
		}
	};

	/** Single-line (default): `Go  5h ════│12%──── ⟳3h47m · Mon ═══════24%│─── · 14d …` */
	const singleLine = () => {
		const current = data();
		const layout = layoutWidgetLine(current.windows, now(), width(), props.config.showCountdown);
		return (
			<text>
				<span style={{ fg: color("dim") }}>Go </span>
				<For each={layout.segments}>
					{(segment, i) => (
						<>
							<Show when={i() > 0}>
								<span style={{ fg: color("dim") }}> · </span>
							</Show>
							<span style={{ fg: color("base") }}>{segment.label} </span>
							<For each={buildGaugeSpans(segment)}>
								{(span) => <span style={{ fg: color(span.color) }}>{span.text}</span>}
							</For>
							<Show when={layout.showCountdown && segment.countdown}>
								<span style={{ fg: color("dim") }}> ⟳{segment.countdown}</span>
							</Show>
						</>
					)}
				</For>
				<Show when={sharedStale()}>
					<span style={{ fg: color("warning") }}> (stale)</span>
				</Show>
			</text>
		);
	};

	/** Multi-line variant: title + one full-width bar line per window. */
	const multiLines = () => {
		const current = data();
		const nowMs = now();
		const lines: any[] = [];
		lines.push(
			<text>
				<span style={{ fg: color("dim") }}>OpenCode Go usage</span>
				<Show when={sharedStale()}> (stale)</Show>
			</text>,
		);
		for (const state of current.windows) {
			const parts = windowParts(state, nowMs);
			const filled = barCells(state.usagePercent, 10);
			const pctColor = state.usagePercent !== undefined ? color("base") : color("dim");
			lines.push(
				<text wrapMode="none">
					<span style={{ fg: color("base") }}>{state.label.padEnd(5)}</span>
					<span style={{ fg: color(barColorName(state.usagePercent)) }}>{"█".repeat(filled)}</span>
					<span style={{ fg: color("dim") }}>{"░".repeat(10 - filled)} </span>
					<span style={{ fg: pctColor }}>{parts.pctText}</span>
					<Show when={props.config.showCountdown && parts.resetText}>
						<span style={{ fg: color("dim") }}> reset {parts.resetText}</span>
					</Show>
				</text>,
			);
		}
		return lines;
	};

	return (
		<Show when={visible()}>
			<Show when={props.config.layout === "multi"} fallback={singleLine()}>
				{multiLines()}
			</Show>
		</Show>
	);
}

// ------------------------------------------------------------------- plugin

/** The /usage invocation (fresh fetch via shared state + dialog). */
async function showUsageDialog(
	context: { ui: { dialog: { alert(input: { title: string; message: string }): Promise<void> } } },
	config: GoUsageConfig,
): Promise<void> {
	const apiKey = readApiKeyFromAuthStore();
	if (apiKey === undefined) {
		applyOutcome({
			ok: false,
			kind: "no-key",
			error: 'No API key configured for provider "opencode-go".',
		});
	}
	// /usage always fetches fresh — bypass the widget cache by resetting the
	// shared fetchedAtMs first.
	setShared((current) => (current === undefined ? current : { ...current, fetchedAtMs: 0 }));
	await refresh();
	const current = shared();
	const message =
		current !== undefined
			? `${formatSnapshotText(current.data, config.showCountdown)}${
					sharedStale() ? "\n(stale — last successful fetch, retry later)" : ""
				}`
			: (lastError ?? "usage unavailable: unknown error");
	await context.ui.dialog.alert({
		title: "OpenCode Go usage",
		message,
	});
}

export default Plugin.define({
	id: "opencode-go-usage.tui",
	setup(context) {
		const config = parseGoUsageConfig(context.options);

		// Widget claims. Both placements share one module-level snapshot and
		// one fetch, so they never duplicate HTTP requests — the sidebar gets
		// the multi-line bar layout (fits the narrow column).
		if (config.placement === "promptFooter" || config.placement === "both") {
			context.ui.slot({
				append: "prompt.footer.status",
				render: () => <UsageWidget config={config} />,
			});
		}
		if (config.placement === "sidebar" || config.placement === "both") {
			context.ui.slot({
				append: "sidebar.footer",
				render: () => <UsageWidget config={{ ...config, layout: "multi" }} />,
			});
		}

		// /usage slash + palette command: always a fresh fetch, then dialog.
		// Works regardless of which model is active (the widget itself stays
		// gated on opencode-go). Shares the module-level fetch/state so the
		// widget refreshes from the same fetch.
		//
		// keymap.layer must run inside the host's reactive context — a bare
		// setup() call fails with "Keymap.Provider is missing". Register it
		// from an `app` slot contribution (docs' session-panel pattern), which
		// mounts inside the Solid tree; the layer lives while that slot does.
		context.ui.slot({
			append: "app",
			render: () => {
			context.keymap.layer(() => ({
					mode: "global",
					priority: 10,
					commands: [
						{
							id: "opencode-go-usage.snapshot",
							title: "Show OpenCode Go usage",
							group: "OpenCode Go",
							palette: true,
							slash: { name: "usage" },
							suggested: true,
							run: async (_input) => void (await showUsageDialog(context, config)),
						},
					],
					bindings: [],
				}));
				return null;
			},
		});
	},
});

/** Multi-line plain-text snapshot for the dialog. */
function formatSnapshotText(data: ParsedUsage, showCountdown: boolean): string {
	const nowMs = Date.now();
	return data.windows
		.map((state) => {
			const parts = windowParts(state, nowMs);
			const filled = barCells(state.usagePercent, 10);
			const bar = "█".repeat(filled) + "░".repeat(10 - filled);
			const reset = showCountdown && parts.resetText ? ` reset ${parts.resetText}` : "";
			const dollars = parts.dollarsText !== "" ? ` ${parts.dollarsText}` : "";
			return `${state.label.padEnd(5)} ${bar} ${parts.pctText}${dollars}${reset}`;
		})
		.join("\n");
}

export const WIDGET_TARGET_PROVIDER = TARGET_PROVIDER;
