## What this changes

<!-- One or two sentences: what a user will see differently. -->

## Type

- [ ] New provider adapter (`src/providers/…`)
- [ ] Layout / rendering change (`src/snapshot.ts`, `src/tui.tsx`)
- [ ] Config option (documented in the README table in this PR)
- [ ] Bug fix
- [ ] Docs only
- [ ] Dependency bump

## How it was verified

<!-- Paste the `npm run verify` result, plus a live check if visual. -->

- [ ] `npm run verify` passes locally
- [ ] Checked in a real OpenCode 2 TUI (version: ____)
- [ ] Added/updated unit tests
- [ ] Screenshot attached (required for visual changes)

## Checklist

- [ ] README updated if config keys, the provider table or install steps changed
- [ ] No credentials logged, printed or persisted
- [ ] Nothing in `src/parser.ts` or the ported layout logic was refactored for style
- [ ] No new runtime dependency
