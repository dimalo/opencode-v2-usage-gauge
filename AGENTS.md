# opencode-v2-usage-gauge

OpenCode **V2** CLI (TUI) plugin: an ASCII plan-usage gauge in the prompt
footer or session sidebar, plus a `/usage` command. Ported from the sibling pi
extension `../pi-opencode-go-usage` (same data source, same pure-ASCII gauge
style).

V2-only by design: the plugin API, the slot tree and `cli.json` are all V2.
OpenCode 1 does not load V2 plugins.

## Layout

- `src/providers/types.ts` — the adapter contract (`PlanUsageAdapter`,
  `Credential` union, `PlanUsage`/`PlanWindow`, `PlanOutcome`). This is the
  extension seam: one file per provider, nothing else changes.
- `src/providers/go.ts` — OpenCode Go adapter (endpoint, credential, parse).
  `src/providers/openrouter.ts` — per-key cap, else account balance from
  `/api/v1/credits` (best-effort), else the key's lifetime usage. Future
  adapters (Zen, Copilot, Kiro) go beside them.
- `src/spend.ts` — local consumption meter, still **unwired groundwork** (the
  `computeSessionSpend` path). Pure and side-effect free: sums the tracked
  provider's assistant `cost` over the session family. It exists for
  pay-as-you-go providers; no adapter consumes the *local meter* yet, because
  Zen's balance has no API (anomalyco/opencode#44189). Do not wire it to a
  provider that cannot report a budget — a delta is not a percentage. (The
  `PlanUsage.spend` field itself is now used by the OpenRouter adapter, which
  reports a network-sourced lifetime amount, not a local delta.)
- `src/registry.ts` — the one place adapters are registered and enabled.
- `src/usage.ts` — provider-agnostic plumbing: credential resolution,
  single-flight fetch, 5 min TTL, last-good snapshot retention.
- `src/tui.tsx` — the only OpenCode-specific module (Solid JSX, slot claims,
  keymap layer, per-provider shared state).
- `src/auth.ts` — API-key lookup in OpenCode's auth store, by provider id.
- OpenCode Zen is intentionally **not registered**: its credit balance has no
  API-key endpoint (issue #44189), so a Zen entry could only show a
  session-scoped delta, not a plan gauge. Revisit when the endpoint ships.
- `src/parser.ts` is **copied verbatim** from the pi extension — do not edit
  here; its unit tests live in `test/` (also carried over verbatim). If the
  upstream pi extension changes the parser, copy it again. The Go adapter
  imports it and normalizes the result into `PlanUsage`.
- `src/ansi.ts`/`src/snapshot.ts` likewise come from the pi extension;
  rendering differs only in that spans are structured (`GaugeSpan`) instead of
  ANSI-painted strings, because the OpenTUI JSX applies theme tokens. The
  layout logic is verbatim; only the accepted input type was widened
  (`WindowLike`) so any adapter's windows can feed it.
- `src/config.ts` is ours (layout, placement, width budget, provider list).

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
- Adapters never log, print or persist credentials.

## Verify

```sh
npm run typecheck
npm test
```

Live smoke (real key in the auth store):

```sh
node --input-type=module -e "import { createPlanSource } from './src/usage.ts';
import { GO_ADAPTER } from './src/providers/go.ts';
const outcome = await createPlanSource(GO_ADAPTER).fetch();
console.log(outcome.ok ? outcome.data.windows : outcome)"
```

The `.tsx` TUI entry cannot be loaded outside the OpenCode TUI (Bun). Manual
approval of rendering happens against the plugin's test ladder in README.md.
