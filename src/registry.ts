/**
 * Adapter registry — the single place where providers are enabled.
 *
 * Adding a provider: write `src/providers/<id>.ts`, import it here and append
 * it to `ADAPTERS`. The widget gate, the `/usage` command and the config
 * `providers` list all read from this array, so nothing else changes.
 */

import { GO_ADAPTER } from "./providers/go.ts";
import type { PlanUsageAdapter } from "./providers/types.ts";

/** Every adapter shipped with the plugin, in display order. */
export const ADAPTERS: readonly PlanUsageAdapter[] = [GO_ADAPTER];

/** Adapter ids in display order (used by config parsing and docs). */
export const ADAPTER_IDS: readonly string[] = ADAPTERS.map((adapter) => adapter.id);

/** Look up one adapter by OpenCode providerID. */
export function adapterForProvider(providerID: string | undefined): PlanUsageAdapter | undefined {
	if (providerID === undefined) return undefined;
	return ADAPTERS.find((adapter) => adapter.id === providerID);
}

/**
 * Resolve the configured `providers` list to adapters.
 *
 * - `"all"` selects every registered adapter.
 * - Unknown ids are dropped silently: a typo degrades to fewer widgets, it
 *   never throws during plugin setup.
 * - An empty/garbage list falls back to every adapter, so a broken config can
 *   never leave the user with no gauge at all.
 */
export function resolveAdapters(ids: readonly string[]): PlanUsageAdapter[] {
	if (ids.length === 0) return [...ADAPTERS];
	const wanted = ids.includes("all") ? ADAPTER_IDS : ids;
	const selected = ADAPTERS.filter((adapter) => wanted.includes(adapter.id));
	return selected.length > 0 ? selected : [...ADAPTERS];
}
