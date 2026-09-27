# opencode-go-usage

OpenCode V2 CLI plugin: OpenCode Go usage widget in the prompt footer plus a
/usage slash command. Ported from the sibling pi extension
`../pi-opencode-go-usage` (same data source, same pure-ASCII gauge style).

## Layout

- `src/parser.ts` is **copied verbatim** from the pi extension — do not edit
  here; its unit tests live in `test/` (also carried over verbatim). If the
  upstream pi extension changes the parser, copy it again.
- `src/ansi.ts`/`src/snapshot.ts` likewise come from the pi extension;
  rendering differs only in that spans are structured (`GaugeSpan`) instead
  of ANSI-painted strings, because the OpenTUI JSX applies theme tokens.
- `src/tui.tsx` is the only OpenCode-specific module (Solid JSX, keymap layer,
  auth-key read, shared fetch/state).
- `src/auth.ts` reads the API key from OpenCode's auth store; the key must
  never be logged or persisted.

## Loader contract (verified on v2.0.18)

The V2 plugin loader resolves **configured plugin directories** through
root-level entry files — effectively `resolve(dir, "server")` and
`resolve(dir, "tui")` (plus `""`/`index`). Package.json `exports` subpaths
are NOT consulted for local directory plugins, and point files are rejected
(`configured plugin path must be a directory`). The top-level `server.ts`
and `tui.tsx` re-export shims must stay; `src/index.ts` and `src/tui.tsx`
hold the real logic.

Install in `~/.config/opencode/cli.json`, **not** `opencode.json`:
`"plugins": ["/abs/path/to/repo"]`, then restart the TUI. This plugin is
TUI-only (its server entry is a stub), and the CLI learns the plugin list
from the server's `Plugin.Info` response, whose schema carries no `options`
— so options declared in `opencode.json` reach `context.options` as `{}`.
`cli.json` is read by the CLI itself and does deliver them. Listing the
plugin in both files double-loads the TUI entry and duplicates slot claims.

## Conventions

- Tabs for TS indentation (matches the pi extension source).
- TypeScript, no build step; OpenCode loads TS/TSX directly (Bun).
- Zero runtime dependencies; `@opencode/plugin` is resolved by the host.
- Missing/renamed endpoint fields degrade to `--`/omitted, never throw.

## Verify

```sh
npm run typecheck
npm test
```

Live smoke (real key in the auth store):

```sh
node --input-type=module -e "import { fetchFromAuthStore } from './src/usage.ts';
const outcome = await fetchFromAuthStore({value: undefined});
console.log(outcome.ok ? outcome.data.windows : outcome)"
```

The `.tsx` TUI entry cannot be loaded outside the OpenCode TUI (Bun). Manual
approval of rendering happens against the plugin's test ladder in README.md.
