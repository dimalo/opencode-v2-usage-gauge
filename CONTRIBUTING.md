# Contributing

Thanks for helping out. This is a small, deliberately boring plugin: an ASCII
gauge in the terminal. Most contributions are a new provider adapter, a fix to
the layout math, or a documentation improvement.

## The one rule that matters most

**Never make the gauge lie, and never crash the TUI.** A missing or renamed
field in a provider's billing API must degrade to `--` or be omitted, never
throw and never invent a number. The host renders this inside its own render
loop; a throw there takes the terminal down with it.

## Setup

```sh
git clone https://github.com/dimalo/opencode-v2-usage-gauge
cd opencode-v2-usage-gauge
npm install
```

Requires Node 22+ (the test runner) and OpenCode 2 (the plugin host). There is
no build step: OpenCode loads the TypeScript directly.

```sh
npm run verify   # compile/type check + unit tests — what CI runs
```

Point your `~/.config/opencode/cli.json` at your checkout to try it live:

```jsonc
{
  "plugins": [
    { "package": "/absolute/path/to/opencode-v2-usage-gauge", "options": { "placement": "sidebar" } }
  ]
}
```

Then restart the TUI. Options only arrive when the plugin is configured in
`cli.json` (see the note in the README), and a TUI restart is required for
code changes to load.

## Adding a provider adapter

This is the most common contribution, and it should touch as little as
possible. Add one file, register one line.

1. **Create `src/providers/<provider>.ts`** implementing `PlanUsageAdapter`
   from `src/providers/types.ts`:

   ```ts
   export const ZEN_ADAPTER: PlanUsageAdapter = {
     id: "opencode-zen",        // must be the OpenCode providerID
     label: "OpenCode Zen",
     planKind: "balance",       // "windows" | "balance" | "both"
     async credential() { /* Credential | undefined */ },
     async fetch(credential) { /* PlanOutcome; never throw */ },
   };
   ```

2. **Register it** in `src/registry.ts` (`ADAPTERS`). That single array drives
   the widget gate, the `/usage` command and the `providers` config option —
   nothing else needs to know.

3. **Add tests** in `test/` for the adapter's parsing and failure mapping. Use
   recorded payloads, never live network calls.

Guidelines for adapters:

- `credential()` returns a `Credential` (`bearer`, `header` or `cookie`) or
  `undefined` when the user has not set that provider up. `undefined` maps to
  the `no-credential` failure, which hides the gauge — that is the correct
  behavior for "not connected", not an error worth showing.
- `fetch()` must resolve, never reject. The shared plumbing in `src/usage.ts`
  catches a rejection and degrades to `transient` (stale data stays on screen),
  but returning a typed failure gives a better message.
- Map the provider's own vocabulary onto `PlanWindow`s with the semantic keys
  `rolling` / `weekly` / `monthly` where they apply, so the shared label logic
  (5h / weekday / Nd-remaining) works unchanged. Set `planKind: "balance"` and
  fill `PlanUsage.balance` for pay-as-you-go providers; the gauge omits the bar
  block and shows the balance line instead.
- Do not add a dependency. The plugin ships zero runtime dependencies and that
  is a feature.
- **Never log, print or persist a credential.** Not in an error message, not in
  a debug line, not in a cache file. If a payload surprises you, report the
  shape (which keys, which types), never the values.
- **Test fixtures must be synthetic.** Copying a value — even a fragment, even
  an ellipsised prefix/suffix — out of a live API response into a fixture is a
  credential leak, and it is the easiest mistake to make in this repo because
  fixtures are supposed to be "recorded". Invent the values; a real prefix and
  suffix are still a real key in two halves.

## Coding conventions

- TypeScript, tabs for indentation, no semicolon-free style — match the
  surrounding file.
- Comments explain *why*, especially for the layout math in `src/snapshot.ts`,
  which has non-obvious constraints (6 cells is the minimum track width; the
  percent label flips side at 50%; widths are measured, not padded).
- `src/parser.ts` and the layout logic in `src/snapshot.ts`/`src/ansi.ts` are
  ported from the sibling pi extension. Do not refactor them for style; port
  changes back to the pi repo instead. If you must widen a type there, keep the
  logic byte-identical and say so in the PR.
- Keep public types honest: optional means "the API may not report this".

## Tests

- Every behavior change needs a test. The suite runs on Node's built-in runner
  (`node --test`), so tests must not need Bun, a TTY or network access.
- Table-driven where it helps; one behavior per `test()`; assert on the exact
  rendered string when the output is user-visible (the gauge line, dialog text).
- If you touch `layoutWidgetLine`, add the narrow-width case. Overflowing the
  shared footer row is a regression we already fixed once.

## Pull requests

1. Branch from `main`, one topic per PR.
2. `npm run verify` must pass locally; CI runs the same two commands.
3. Write the PR description for someone who has never used the plugin: what
   changes visually, which providers/config keys are affected, and how you
   verified it. Include a screenshot for anything visual.
4. Dependabot opens version-bump PRs against this repo; they are held to the
   same `npm run verify` gate, so a red bump is a real regression.
5. Keep the README honest: if you change config keys, the provider table or the
   install instructions, update the README in the same PR.

## Reporting bugs

Open an issue with your `opencode --version`, the relevant part of
`~/.local/share/opencode/log/opencode.log` (redact keys, cookies and
authorization headers), and what you expected versus what rendered. A screenshot
of the gauge is worth a lot.

## Adding your provider to the awesome list

Not required, but if your adapter is useful, add a YAML entry to
[awesome-opencode](https://github.com/awesome-opencode/awesome-opencode) via a
PR to `data/plugins/` — see its `contributing.md`.

## License

By contributing you agree that your work is licensed under the MIT License,
same as the rest of the project.
