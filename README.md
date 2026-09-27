# opencode-v2-usage-gauge

**An ASCII plan-usage gauge for the OpenCode 2 TUI** — a single line in the
prompt footer (or a block in the session sidebar), plus a `/usage` command.
Zero config: the credential comes from OpenCode's own auth store.

```
Go  5h ════│8%────── ⟳3h26m · Mon ═══════│44%── · 18d ═══════│42%──
```

> **Requires OpenCode 2 (v2.0.18+).** This is a V2 CLI plugin: it uses the V2
> plugin API, the V2 slot tree (`prompt.footer.status`, `sidebar.footer`) and
> is configured in `cli.json`. OpenCode 1 will not load it — V1 plugin
> implementations do not run in V2. Check with `opencode --version`.

## Why this one

Most plan-usage plugins ask you to go get a credential: paste a browser
cookie, copy a workspace id, export an env var. This one doesn't. It reads the
key you already connected to OpenCode, so for OpenCode Go it works the moment
you install it.

- **Zero configuration** — no cookie, no workspace id, no config file, no secrets in your config.
- **Always visible, zero context cost** — one ASCII line appended to the prompt footer row. It never enters the conversation, so it can't pollute the model's context.
- **Follows your model** — the gauge tracks whichever provider the selected model belongs to.
- **Pluggable providers** — each billing API is a small adapter that normalizes to one shape. OpenCode Go ships today; OpenCode Zen, GitHub Copilot, Kiro and others are additive.
- **No dependencies, no build step** — TypeScript loaded directly by the host. 79 unit tests.

## Install

```bash
git clone https://github.com/dimalo/opencode-v2-usage-gauge
cd opencode-v2-usage-gauge && npm install   # zero runtime deps; node_modules only for dev
```

```jsonc title="~/.config/opencode/cli.json"
{
  "plugins": ["opencode-v2-usage-gauge"]
}
```

With options:

```jsonc title="~/.config/opencode/cli.json"
{
  "plugins": [
    {
      "package": "opencode-v2-usage-gauge",
      "options": { "placement": "sidebar" }
    }
  ]
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
cp -R opencode-v2-usage-gauge ~/.config/opencode/plugins/opencode-v2-usage-gauge
```

(Files, `src/…` paths and `exports` subpaths are NOT accepted for local
directory plugins — the loader resolves `server`/`tui` at the directory root.)

Then restart OpenCode (`opencode service restart`, and restart any open TUI
instances — the TUI entry loads per TUI process).

## Config

| Key             | Values                                        | Default          | Meaning                                                       |
| --------------- | --------------------------------------------- | ---------------- | ------------------------------------------------------------- |
| `layout`        | `"single"` \| `"multi"`                       | `"single"`       | One compact line, or a title plus one line per window         |
| `showCountdown` | `true` \| `false`                             | `true`           | Show reset countdowns (⟳ on the line; `reset …` in multi/dialog) |
| `placement`     | `"promptFooter"` \| `"sidebar"` \| `"both"`   | `"promptFooter"` | Claim the prompt footer row, the session sidebar, or both. `sidebar` renders the multi-line variant |
| `maxWidth`      | number of cells                               | `0` (auto)       | Cell budget for the single line. `0` = at most half the row (min 48), because the footer row is shared with the built-in cost/hint items |
| `providers`     | `"all"` or a list of adapter ids              | `["opencode-go"]` | Which providers the gauge tracks. The gauge follows the selected model, so this is a filter on top of "provider has an adapter" |

The options hold **no secrets** — credentials stay in OpenCode's auth store.

## Providers

An adapter answers two questions for one OpenCode `providerID`: how to
authenticate, and what its billing API says. Everything else — the gauge, the
width math, the sidebar layout, the dialog — is provider-agnostic.

| Adapter id      | Plan            | Credential                              | Status |
| --------------- | --------------- | --------------------------------------- | ------ |
| `opencode-go`   | rolling / weekly / monthly windows | key from OpenCode's auth store | shipped |

Adding one is a single file in `src/providers/` plus a line in
`src/registry.ts`:

```ts
export const ZEN_ADAPTER: PlanUsageAdapter = {
  id: "opencode-zen",
  label: "OpenCode Zen",
  planKind: "balance",              // windows | balance | both
  async credential() { /* bearer | header | cookie */ },
  async fetch(credential) { /* → PlanOutcome */ },
};
```

Credentials are a union (`bearer` / `header` / `cookie`) on purpose: API-key
providers and OAuth/console providers need different things, and the interface
should not force a rewrite when the second kind arrives. Pay-as-you-go
providers report `balance` instead of `windows`; the gauge omits what a
provider does not have instead of rendering a lie.

## Nothing shows up?

1. `opencode --version` reports `1.x` → this plugin is OpenCode 2 only. V1 does not load V2 plugins.
2. Installed via `tui.json` / a `plugin` (singular) key → move the entry to `cli.json` `plugins` (V2 auto-migrates `tui.json` for you).
3. Configured correctly but silent → the gauge follows the *selected model*. Pick a model from a tracked provider (`/models`). `/usage` works regardless of the selected model.
4. `/usage` says no credentials → connect the provider first (`/connect` → OpenCode Go). The plugin never invents or stores credentials.

## Not this one? Try these

Honest alternatives, all solving a slightly different problem:

- [slkiser/opencode-quota](https://github.com/slkiser/opencode-quota) — multi-provider quota and token tracking with toasts and slash commands.
- [opencode-go-usage-tui](https://www.npmjs.com/package/opencode-go-usage-tui) — OpenCode Go quota plus per-model price/limit tables and change tracking (needs a console cookie).
- [ColorlessBoy/opencode-go-quota](https://github.com/ColorlessBoy/opencode-go-quota) — `/quota` dialog with multi-plan key switching.
- [wiscaksono/opencode-usage](https://github.com/wiscaksono/opencode-usage) — native macOS menu bar app for the same numbers.

## Development

```sh
npm run typecheck
npm test
```

`src/parser.ts`, `src/ansi.ts` and `src/snapshot.ts` are ported from the
sibling pi extension; the layout logic is verbatim, with the accepted window
type widened so provider adapters can feed it. Everything provider-specific
lives in `src/providers/`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — including how to add a provider
adapter, the "never make the gauge lie, never crash the TUI" rule, and the test
gate every PR (and every Dependabot bump) has to pass.

Security: credentials are read in memory and never persisted. Report
vulnerabilities via [private advisories](SECURITY.md).

## License

MIT
