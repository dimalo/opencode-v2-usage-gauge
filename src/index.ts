/**
 * opencode-go-usage — server plugin entry.
 *
 * All behavior lives in the TUI entry (`src/tui.tsx`, exported as `./tui`):
 * the prompt-footer usage widget and the /usage slash command are purely
 * client-side. This server-side entry exists so the package can also be
 * loaded as a normal plugin; it currently registers nothing.
 *
 * Deliberately NOT implemented here (on purpose, per scope): zen / credit
 * balance usage. The widget keys solely off the Go plan usage windows and is
 * only visible while an `opencode-go` model is selected.
 */

import { Plugin } from "@opencode/plugin";

export default Plugin.define({
	id: "opencode-go-usage",
	setup() {
		// No server-side behavior (yet).
	},
});
