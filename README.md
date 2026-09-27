# opencode-go-usage

OpenCode plugin: show your **OpenCode Go** subscription usage in the TUI — a
**single-line ASCII gauge** appended to the prompt footer status row with the
three budget windows (rolling 5h / weekly / monthly), dynamic window labels
and a live rolling countdown, plus a `/usage` slash command that shows the
full three-window snapshot in a dialog (and refreshes the widget).

The widget appears **only while an `opencode-go` model is the selected model**
(`providerID === "opencode-go"`) and disappears automatically when you switch
to another provider. The `/usage` command works regardless of the active
model (it always queries the `opencode-go` endpoint). Out of scope for now:
zen / credit-balance usage — Go plan windows only; may be extended later.

```
Go  5h ════│12%────── ⟳3h47m · Mon ═══════24%│─── · 14d ════│12%──────
```

Each segment is a **pure-ASCII gauge**: `═` for the filled span, `─` for the
unfilled track, a `│` divider at the fill boundary, and the percentage drawn
INSIDE the track — trailing the divider below 50% (`│12%`), prefixing it at
50%+ (`60%│`). Only the percent text is colored by threshold
(< 75% theme accent, 75–99% warning, ≥ 100% error); track glyphs are dim.

Labels are dynamic: rolling `5h` (+ the `⟳` countdown), weekly = weekday the
week rolls over on (`Mon`…`Sun`), monthly = days remaining (`14d`). Track
width is **variable**: recomputed every render from the terminal width. On
narrow terminals the countdown is dropped first, then tracks shrink to a
minimum of 6 cells, then the line truncates.

## How it works

- **Data source:** the official usage endpoint
  `GET https://opencode.ai/zen/go/v1/usage` (live since 2026-08-11, upstream
  PR anomalyco/opencode#16513). Bearer auth only. Observed live payload:
  `{"usage":{"rolling":{"status":"ok","percent":3,"resetsAt":"..."},...}}` —
  the parser stays lenient against renames.
- **Auth:** the API key is read at runtime from OpenCode's own auth store
  (`~/.local/share/opencode/auth.json` → `"opencode-go"` entry, `XDG_DATA_HOME`
  aware; see `src/auth.ts`). The key is never logged, printed, or written to
  any file by this plugin.
- **Fetching:** on plugin mount and then at most every ~5 min (TTL); a 60 s
  ticker refreshes the countdown and triggers a re-fetch once the cache has
  aged past the TTL. Transient failures keep the last data visible, marked
  `(stale)`. A 401 or a missing key hides the widget — no plan, no widget.
- **Shared state:** the widget and `/usage` share one module-level snapshot
  and one single-flight fetch, so `/usage` never duplicates a request and a
  fresh fetch updates the widget immediately.
- **No server-side behavior:** the server entry (`src/index.ts`) is a stub;
  all behavior is client-side (TUI) and therefore active only in the terminal.

## Install

Verified on OpenCode `v2.0.18`.

Option A — configure the local clone directly (global config). The plugin
MUST be given as a **directory** and needs the repo's root-level `server.ts`
and `tui.tsx` entry files (both included here):

```bash
git clone <repo-url> opencode-go-usage
cd opencode-go-usage && npm install   # zero runtime deps; node_modules only for dev
```

```jsonc title="~/.config/opencode/cli.json"
{
  "plugins": ["/absolute/path/to/opencode-go-usage"]
}
```

> **Configure it in `cli.json`, not `opencode.json`.** Everything this plugin
> does is TUI-side, and the CLI only learns *which* plugins to load from the
> server's `Plugin.Info` list, whose schema (`openapi.json`) has no `options`
> field (`additionalProperties: false`). Options configured in `opencode.json`
> therefore arrive as `{}` in `context.options`; `cli.json` is read by the CLI
> itself and does deliver them. Listing the plugin in both files loads the TUI
> entry twice and duplicates every slot claim.

Option B — drop the clone into the global discovery directory:

```bash
cp -R opencode-go-usage ~/.config/opencode/plugins/opencode-go-usage
```

(Files, `src/…` paths and `exports` subpaths are NOT accepted for local
directory plugins — the loader resolves `server`/`tui` at the directory root.)

Then restart OpenCode (`opencode service restart`, and restart any open TUI
instances — the TUI entry loads per TUI process).

## Config

Pass plugin options in the `plugins` entry of `cli.json` (object form), e.g.:

```jsonc title="~/.config/opencode/cli.json"
{
  "plugins": [
    { "package": "/absolute/path/to/opencode-go-usage", "options": { "placement": "sidebar" } }
  ]
}
```

| Key            | Values                       | Default    | Meaning                                                       |
| -------------- | ---------------------------- | ---------- | ------------------------------------------------------------- |
| `layout`       | `"single"` \| `"multi"`      | `"single"` | One compact line, or a title plus one line per window         |
| `showCountdown`| `true` \| `false`            | `true`     | Show reset countdowns (⟳ on the line; `reset …` in multi/dialog) |
| `placement`    | `"promptFooter"` \| `"sidebar"` \| `"both"` | `"promptFooter"` | Claim the prompt footer row, the session sidebar, or both. `sidebar` renders the multi-line variant |
| `maxWidth`     | number of cells              | `0` (auto) | Cell budget for the single line. `0` = at most half the row (min 48), because the footer row is shared with the built-in cost/hint items |

The options hold **no secrets** — the API key always stays in OpenCode's
auth store.

## Requirements

- OpenCode V2 (`v2.0.18+`) with the `opencode-go` provider connected
  (`/connect` → OpenCode Go).
- An `opencode-go` model selected (`/models`) for the widget to appear.

## Manual test plan (run in the real TUI)

1. **Show:** start the TUI with an `opencode-go` model selected. Within a few
   seconds a single line appears in the prompt footer status row with three
   ASCII gauges (`Go  5h ════│12%──── ⟳3h47m · Mon … · 14d …`), refreshed from
   the live endpoint.
2. **Variable-width tracks:** resize the terminal — every gauge grows/shrinks
   (equal split). Narrow down: the countdown drops first, then tracks hold at
   6 cells, then the line truncates with `…`. Watch the % flip sides of the
   divider as spending crosses 50%.
3. **Multi layout:** set `"layout": "multi"` in the plugin options, restart →
   title + one line per window (10-cell bar, percent, `reset …`).
   `"showCountdown": false` → all countdowns disappear.
4. **Switch away:** `/models` to a non-`opencode-go` model — the widget
   disappears immediately; switching back re-shows it (cached, no refetch if
   < 5 min).
5. **Stale path:** disconnect the network, switch model away and back → the
   previously fetched numbers reappear with a `(stale)` marker instead of
   crashing or vanishing.
6. **401 path:** revoke/reset the opencode-go key in the auth store
   (temporarily), switch model away and back → widget stays hidden, no errors.
7. **Periodic refresh:** leave the session open ~5–6 minutes while running a
   few Go requests → the gauges update by themselves; the `⟳` countdown keeps
   ticking every minute.
8. **`/usage`:** type `/usage` with any model active → a dialog shows the
   three windows (label, 10-cell bar, percent, dollars when reported, reset
   countdown); the widget refreshes from the same fetch.
9. **`/usage` — no key configured:** temporarily point the plugin at a
   machine without the opencode-go auth entry → an error line shows
   ("No API key configured…"), nothing crashes.

## Development

```bash
npm install        # devDependencies + @opencode/plugin + TUI peer types
npm test           # node --test — parser/formatter/geometry unit tests
npm run typecheck  # tsc --noEmit (incl. JSX types from @opentui/solid)
```

Source layout:

- `src/tui.tsx` — TUI entry: widget Solid component (slot append
  `prompt.footer.status`), `/usage` keymap command, shared fetch/state.
- `src/index.ts` — server entry stub (package loading convention).
- `src/usage.ts` — endpoint fetch, failure classification, single-flight.
- `src/auth.ts` — API-key resolution from OpenCode's auth store.
- `src/parser.ts` — dependency-free lenient parser + formatters (ported from
  the pi extension sibling `pi-opencode-go-usage`, same contributor).
- `src/snapshot.ts` / `src/ansi.ts` — gauge geometry + width math.
- `src/cache.ts` — disk-cache schema helpers (kept from the port; the TUI
  currently shares state in-process, no disk cache is written).
- `test/` — unit tests (`node --test`, Node's native type stripping).

The `src/tui.tsx` entry cannot be smoke-loaded under plain Node (never runs
outside the OpenCode TUI's Bun runtime); it is validated with
`tsc --noEmit` and the shared logic is unit-tested directly. Follow the
manual test plan above for behavior in the real TUI.

## Caveats

- Field names of the usage endpoint are **not formally pinned**; the parser
  degrades gracefully — worst case the widget shows `--` for a field.
- The single-line gauge cell math is verified against OpenTUI's
  width calculations for the ASCII/box-drawing glyphs used; if a future
  font renders `│`/`═`/`─` wider than 1 cell, the layout could compress —
  report it and it can fall back to `=`/`-`/`|`.
- Slot path `prompt.footer.status` is documented plugin API but the host
  layout around it may evolve; an additive `append` claim degrades to the
  nearest surviving ancestor path if OpenCode renames it.

## License

MIT
