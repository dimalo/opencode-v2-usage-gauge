/**
 * opencode-v2-usage-gauge — TUI (CLI plugin) entry.
 *
 * Shows the selected provider's plan usage in the OpenCode V2 terminal UI as a
 * single-line ASCII gauge, plus a `/usage` command that shows the full snapshot
 * in a dialog. The gauge follows the selected model: pick an `opencode-go`
 * model and you get the Go plan windows.
 *
 *     Go  5h ════│12%────── ⟳3h47m · Mon ═══════24%│─── · 14d ════│12%──────
 *
 * Providers are adapters (`src/providers/`): each one resolves a credential
 * and normalizes its billing API into `PlanUsage`. OpenCode Go ships today;
 * Zen, Copilot and others are additive. The gauge, layout math and this file's
 * rendering are provider-agnostic.
 *
 * Credentials come from OpenCode's own auth store (for Go: the key already
 * connected for that provider) and are never logged, printed or persisted.
 *
 * Requires OpenCode 2: this is a V2 CLI plugin using the V2 plugin API, slot
 * tree and `cli.json`. V1 plugin implementations do not run in V2.
 */

import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { For, Show, createMemo, createSignal } from "solid-js";
import { onCleanup, onMount } from "solid-js";
import { parseConfig, type GaugeConfig } from "./config.ts";
import type { PlanUsage, PlanUsageAdapter } from "./providers/types.ts";
import { CACHE_TTL_MS, WIDGET_TICK_MS, createPlanSource, type PlanSource } from "./usage.ts";
import { adapterForProvider, resolveAdapters } from "./registry.ts";
import {
	barCells,
	barColorName,
	joinSnapshotLines,
	layoutWidgetLine,
	windowParts,
	type WidgetSegment,
} from "./snapshot.ts";
import { spendAmountText, spendDetailText, spendWidgetBody, spendWidgetLine } from "./spend.ts";

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

// --------------------------------------------------------------------- state

/** Last good snapshot per provider, plus whether it is currently stale. */
interface ProviderState {
	data: PlanUsage;
	fetchedAtMs: number;
	stale: boolean;
}

/**
 * Shared module-level state (a Signal at module scope is safe in Solid — only
 * computeds need ownership). The widget and the /usage command read and update
 * the same records, so a /usage fetch immediately refreshes the gauge, and the
 * two placements never issue duplicate requests.
 */
const [states, setStates] = createSignal<Record<string, ProviderState>>({});
/** Human-readable reason of the last failed fetch per provider. */
const [errors, setErrors] = createSignal<Record<string, string>>({});

/** One single-flight source per adapter, created lazily. */
const sources = new Map<string, PlanSource>();

function sourceFor(adapter: PlanUsageAdapter): PlanSource {
	const existing = sources.get(adapter.id);
	if (existing !== undefined) return existing;
	const created = createPlanSource(adapter);
	sources.set(adapter.id, created);
	return created;
}

/** Fetch one provider's usage and fold the outcome into shared state. */
async function refresh(adapter: PlanUsageAdapter, options: { force?: boolean } = {}): Promise<void> {
	const source = sourceFor(adapter);
	if (options.force === true) {
		// /usage always shows fresh data: drop the cached timestamp first.
		setStates((current) => {
			if (current[adapter.id] === undefined) return current;
			const next = { ...current };
			delete next[adapter.id];
			return next;
		});
	} else {
		const fetchedAtMs = source.fetchedAtMs();
		if (fetchedAtMs !== undefined && Date.now() - fetchedAtMs < CACHE_TTL_MS) return;
	}

	const outcome = await source.fetch();
	if (outcome.ok) {
		setStates((current) => ({
			...current,
			[adapter.id]: {
				data: outcome.data,
				fetchedAtMs: outcome.data.fetchedMs,
				stale: false,
			},
		}));
		setErrors((current) => {
			if (current[adapter.id] === undefined) return current;
			const next = { ...current };
			delete next[adapter.id];
			return next;
		});
		return;
	}

	setErrors((current) => ({ ...current, [adapter.id]: outcome.error }));
	if (outcome.kind === "no-credential" || outcome.kind === "unauthorized") {
		// No plan / credential rejected → hide the gauge for that provider.
		setStates((current) => {
			if (current[adapter.id] === undefined) return current;
			const next = { ...current };
			delete next[adapter.id];
			return next;
		});
		return;
	}
	// Transient failure: keep the previous snapshot visible, marked stale.
	setStates((current) => {
		const previous = current[adapter.id];
		if (previous === undefined) return current;
		return { ...current, [adapter.id]: { ...previous, stale: true } };
	});
}

// ------------------------------------------------------------------ component

function UsageGauge(props: { config: GaugeConfig; adapters: PlanUsageAdapter[] }) {
	const context = usePlugin();
	const [now, setNow] = createSignal(Date.now());

	/** The adapter serving the currently selected model, if we track it. */
	const active = createMemo(() => {
		const providerID = context.ui.model.current()?.providerID;
		const adapter = adapterForProvider(providerID);
		if (adapter === undefined) return undefined;
		return props.adapters.some((candidate) => candidate.id === adapter.id) ? adapter : undefined;
	});

	const state = () => {
		const adapter = active();
		return adapter === undefined ? undefined : states()[adapter.id];
	};

	onMount(() => {
		// Prefetch every configured provider once, so switching models shows a
		// gauge immediately instead of waiting for the TTL tick.
		for (const adapter of props.adapters) void refresh(adapter);
		const ticker = setInterval(() => {
			try {
				const adapter = active();
				if (adapter !== undefined) void refresh(adapter);
				setNow(Date.now()); // minute-granularity countdown re-render
			} catch {
				// Never crash the TUI from a tick.
			}
		}, WIDGET_TICK_MS);
		onCleanup(() => clearInterval(ticker));
	});

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

	/** Prefix: provider short name, so a Zen gauge never reads as a Go gauge. */
	const prefix = () => {
		const adapter = active();
		return adapter === undefined ? "" : `${shortLabel(adapter)} `;
	};

	/** Single-line layout: `Go  5h ═══│12%─── ⟳3h47m · Mon ═══│24%── · 14d …` */
	const singleLine = () => {
		const current = state();
		if (current === undefined) return null;
		// The prompt footer is a SHARED row — the built-in cost/hint items
		// render next to the claim, so budgeting the full terminal width
		// overflows and wraps. Take at most half the row, or `maxWidth`.
		const full = Math.max(40, context.renderer.width);
		const budget =
			props.config.maxWidth > 0
				? Math.min(full, props.config.maxWidth)
				: Math.max(48, Math.min(full, Math.floor(full / 2)));
		// No quota windows: show the account balance if we have one, else the
		// key's measured spend. Never a bar (no denominator), never an
		// explanation — and if there is no number at all, hide entirely rather
		// than leaving a dangling prefix.
		if (current.data.windows.length === 0) {
			const balance = current.data.balance;
			if (balance !== undefined) {
				return (
					<text>
						<span style={{ fg: color("dim") }}>{prefix()}balance </span>
						<span style={{ fg: color("base") }}>
							{balance.remaining.toFixed(2)} {balance.currency}
						</span>
						<Show when={current.stale}>
							<span style={{ fg: color("warning") }}> (stale)</span>
						</Show>
					</text>
				);
			}
			const spent = current.data.spend;
			if (spent === undefined || spendWidgetLine(spent, prefix(), budget) === undefined) {
				return null;
			}
			return (
				<text>
					<span style={{ fg: color("dim") }}>{prefix()}</span>
					<span style={{ fg: color("base") }}>{spendWidgetBody(spent)}</span>
					<Show when={current.stale}>
						<span style={{ fg: color("warning") }}> (stale)</span>
					</Show>
				</text>
			);
		}
		// The provider tag is measured, not assumed: "Go " is 3 cells, "Zen "
		// would be 4, and a wrong guess silently steals track width.
		const layout = layoutWidgetLine(
			current.data.windows,
			now(),
			budget,
			props.config.showCountdown,
			prefix().length,
		);
		return (
			<text>
				<span style={{ fg: color("dim") }}>{prefix()}</span>
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
				<Show when={current.stale}>
					<span style={{ fg: color("warning") }}> (stale)</span>
				</Show>
			</text>
		);
	};

	/** Multi-line variant: title + one fixed-width bar line per window. */
	const multiLines = () => {
		const current = state();
		if (current === undefined) return null;
		// Nothing measured (no window, no balance, no spend) → render nothing
		// at all: no bare title, and no explanation. The reason lives in
		// `/usage`, not in the always-on sidebar.
		if (
			current.data.windows.length === 0 &&
			current.data.balance === undefined &&
			current.data.spend === undefined
		) {
			return null;
		}
		const adapter = active();
		const title = adapter === undefined ? "Plan usage" : `${adapter.label} usage`;
		const nowMs = now();
		const lines: unknown[] = [
			<text>
				<span style={{ fg: color("dim") }}>{title}</span>
				<Show when={current.stale}> (stale)</Show>
			</text>,
		];
		if (current.data.planName !== undefined) {
			lines.push(
				<text>
					<span style={{ fg: color("dim") }}>{current.data.planName}</span>
				</text>,
			);
		}
		for (const window of current.data.windows) {
			const parts = windowParts(window, nowMs);
			const filled = barCells(window.usagePercent, 10);
			const pctColor = window.usagePercent !== undefined ? color("base") : color("dim");
			lines.push(
				<text wrapMode="none">
					<span style={{ fg: color("base") }}>{window.label.padEnd(5)}</span>
					<span style={{ fg: color(barColorName(window.usagePercent)) }}>
						{"█".repeat(filled)}
					</span>
					<span style={{ fg: color("dim") }}>{"░".repeat(10 - filled)} </span>
					<span style={{ fg: pctColor }}>{parts.pctText}</span>
					<Show when={props.config.showCountdown && parts.resetText}>
						<span style={{ fg: color("dim") }}> reset {parts.resetText}</span>
					</Show>
				</text>,
			);
		}
		if (current.data.balance !== undefined) {
			const { remaining, currency } = current.data.balance;
			lines.push(
				<text>
					<span style={{ fg: color("dim") }}>balance </span>
					<span style={{ fg: color("base") }}>
						{remaining.toFixed(2)} {currency}
					</span>
				</text>,
			);
		}
		// The balance is the headline when present, so the lifetime spend is
		// shown only as a fallback (no balance to report).
		if (current.data.spend !== undefined && current.data.balance === undefined) {
			lines.push(
				<text>
					<span style={{ fg: color("dim") }}>spent </span>
					<span style={{ fg: color("base") }}>{spendAmountText(current.data.spend)}</span>
				</text>,
			);
		}
		return lines as never[];
	};

	return (
		<Show when={state() !== undefined}>
			<Show when={props.config.layout === "multi"} fallback={singleLine()}>
				{multiLines()}
			</Show>
		</Show>
	);
}

/** Compact provider tag for the single-line prefix ("Go", "Zen", "Copilot"). */
function shortLabel(adapter: PlanUsageAdapter): string {
	const first = adapter.label.split(" ")[0] ?? adapter.label;
	return first === "OpenCode" ? adapter.label.replace("OpenCode ", "") : first;
}

// -------------------------------------------------------------------- command

/** Which provider /usage reports on: the selected model, else the first configured. */
function adapterForCommand(
	adapters: PlanUsageAdapter[],
	providerID: string | undefined,
): PlanUsageAdapter | undefined {
	return adapterForProvider(providerID) ?? adapters[0];
}

/** The /usage invocation (fresh fetch via shared state + dialog). */
async function showUsageDialog(
	context: {
		ui: {
			model: { current(): { providerID: string } | undefined };
			dialog: { alert(input: { title: string; message: string }): Promise<void> };
		};
	},
	adapters: PlanUsageAdapter[],
	showCountdown: boolean,
): Promise<void> {
	const adapter = adapterForCommand(adapters, context.ui.model.current()?.providerID);
	if (adapter === undefined) {
		await context.ui.dialog.alert({
			title: "Plan usage",
			message: "No plan provider is configured for this session.",
		});
		return;
	}
	await refresh(adapter, { force: true });
	const state = states()[adapter.id];
	const error = errors()[adapter.id];
	const body =
		state !== undefined
			? `${formatSnapshotText(state.data, showCountdown)}${state.stale ? "\n(stale — last successful fetch, retry later)" : ""}`
			: (error ?? "usage unavailable: unknown error");
	await context.ui.dialog.alert({
		title: `${adapter.label} usage`,
		message: body,
	});
}

/** Multi-line plain-text snapshot for the dialog. */
function formatSnapshotText(data: PlanUsage, showCountdown: boolean): string {
	const nowMs = Date.now();
	const lines = data.windows.map((window) => {
		const parts = windowParts(window, nowMs);
		const filled = barCells(window.usagePercent, 10);
		const bar = "█".repeat(filled) + "░".repeat(10 - filled);
		const reset = showCountdown && parts.resetText ? ` reset ${parts.resetText}` : "";
		const dollars = parts.dollarsText !== "" ? ` ${parts.dollarsText}` : "";
		return `${window.label.padEnd(5)} ${bar} ${parts.pctText}${dollars}${reset}`;
	});
	if (data.balance !== undefined) {
		lines.push(`balance ${data.balance.remaining.toFixed(2)} ${data.balance.currency}`);
	}
	if (data.spend !== undefined) {
		lines.push(spendDetailText(data.spend));
	}
	// No explanation alongside a number: the note is only the last resort when
	// there is nothing at all to report (a blank dialog would read as broken).
	return joinSnapshotLines(lines, data.note);
}

// --------------------------------------------------------------------- plugin

export default Plugin.define({
	id: "opencode-v2-usage-gauge.tui",
	setup(context) {
		const config = parseConfig(context.options);
		const adapters = resolveAdapters(config.providers);

		// Widget claims. Both placements read the same shared state and go
		// through the same single-flight source, so they never duplicate HTTP
		// requests; the sidebar gets the multi-line layout (narrow column).
		if (config.placement === "promptFooter" || config.placement === "both") {
			context.ui.slot({
				append: "prompt.footer.status",
				render: () => <UsageGauge config={config} adapters={adapters} />,
			});
		}
		if (config.placement === "sidebar" || config.placement === "both") {
			context.ui.slot({
				append: "sidebar.footer",
				render: () => <UsageGauge config={{ ...config, layout: "multi" }} adapters={adapters} />,
			});
		}

		// /usage slash + palette command: always a fresh fetch, then a dialog.
		// Works regardless of which model is active (the gauge itself follows
		// the selected model). keymap.layer must run inside the host's reactive
		// context — a bare setup() call fails with "Keymap.Provider is missing" —
		// so it is registered from an `app` slot contribution, which mounts
		// inside the Solid tree.
		context.ui.slot({
			append: "app",
			render: () => {
				context.keymap.layer(() => ({
					mode: "global",
					priority: 10,
					commands: [
						{
							id: "opencode-v2-usage-gauge.snapshot",
							title: "Show plan usage",
							group: "Usage",
							palette: true,
							slash: { name: "usage" },
							suggested: true,
							run: async (_input) =>
								void (await showUsageDialog(context, adapters, config.showCountdown)),
						},
					],
					bindings: [],
				}));
				return null;
			},
		});
	},
});
