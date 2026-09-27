/**
 * opencode-v2-usage-gauge — server plugin entry.
 *
 * All behavior lives in the TUI entry (`src/tui.tsx`, exported as `./tui`):
 * the plan-usage gauge and the /usage slash command are purely client-side.
 * This server-side entry exists so the package can also be loaded as a normal
 * plugin; it currently registers nothing.
 *
 * Requires OpenCode 2: the TUI entry uses the V2 plugin API (slots, keymap
 * layers) and is loaded from `cli.json`. V1 plugin implementations do not run
 * in V2, so this entry is a no-op there by design rather than a partial port.
 */

import { Plugin } from "@opencode/plugin";

export default Plugin.define({
	id: "opencode-v2-usage-gauge",
	setup() {
		// No server-side behavior (yet). Provider adapters live in
		// src/providers/ and are consumed by the TUI entry.
	},
});
