# Contributing to Landed

Thanks for helping. Landed is a local-first tool that reads private data: agent transcripts and git history. The bar for privacy and correctness is high, and most of the rules below follow from that.

## Setup

Requires Node.js ≥ 22.12 and git. pnpm comes from corepack.

```bash
corepack enable pnpm
pnpm install
pnpm lint && pnpm typecheck && pnpm test
pnpm build && pnpm landed scan
```

## Before you start

- **Read the spec:**
  - [PRD.md](PRD.md) is the product spec.
  - [docs/architecture.md](docs/architecture.md) holds the contracts.
  - [docs/sources.md](docs/sources.md) describes the vendor file formats.
- **Open an issue first** for anything bigger than a small fix, so we can agree on the approach.

## Rules that are not negotiable

These come from PRD §28.

1. **Never persist prompt text, code lines, tool output or environment values.** Store salted fingerprints only. Every display string goes through redaction.
2. **Never write** to vendor session files, vendor config, git repos or user files. The only exceptions are the explicit, previewed `--yes` install commands.
3. **Git runs read-only.** Use argument arrays and timeouts, and only allow-listed subcommands (`packages/git-index/src/git.ts`).
4. **Vendor-specific code lives only in `packages/importer-*`.** Never assume a vendor field exists; "unknown" is a valid state.
5. **Outcome rule changes** need golden git tests (`packages/outcomes/src/golden.test.ts`) and an `ENGINE_VERSION` bump.
6. **Parser changes** need sanitized fixtures and tests. Plant `CANARY_` strings in anything that must never be stored; tests assert they never reach the database.
7. **Every user-facing claim carries a provenance:** observed, derived, inferred or generated.

`pnpm lint` enforces the package boundaries and the vendor-literal rule (`scripts/check-boundaries.mjs`).

## Fixtures from real data

Fixtures built from your own session files must be sanitized:
- replace code with placeholders;
- remove prompts, secrets, names and paths;
- use `{{REPO}}` for repository roots.

When in doubt, write the fixture by hand.

## Pull requests

- Keep each change a small vertical slice, with tests.
- Update `docs/` when a contract changes.
- Run `pnpm format` before pushing. CI runs lint, typecheck, tests, the build, and a migration drift check on macOS.
- After a schema change, run `pnpm --filter @landed/db db:generate` and commit the migration. Never hand-edit `migrations/`.

## Reporting wrong results

A wrong outcome, a false open loop or a bad thread link is a bug. Please use the "Wrong result" issue template. Describe what Landed showed and what git actually shows (`git status`, `git log`, `git branch --contains`). **Never paste code, prompts or transcript lines.**

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
