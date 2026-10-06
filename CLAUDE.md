# Landed

A local-first outcome ledger for AI coding agents. Landed reads Claude Code and Codex session files, extracts each file edit an agent made, and matches those edits against git history. That shows what agent work became: landed, uncommitted, lost, colliding, or dangling.

- Product source of truth: `PRD.md`. Read it before you change anything.
- Feasibility evidence: `spike/FINDINGS.md`. `spike/` is reference material only and is never imported.
- Architecture and contracts: `docs/architecture.md`.

## Status

- v0.1-Retro is feature-complete (PRD §24 phases 0–12):
  - importers, `ingest` pipelines, the outcome engine, threads, loops and insights;
  - the brief and report, and the optional summarizer;
  - `apps/server`, `apps/web`, and the `landed` CLI.
- v0.2-Live is implemented (phases 14–19):
  - background collector (`landed start|stop|status`, `autostart`), FSEvents watchers and SSE;
  - Claude Code plugin (HTTP hooks) and Codex hooks (command relay), with live notifications;
  - agent fit by kind of work.
- v0.3-Memory is implemented (phase 20):
  - `landed mcp`, a stdio MCP server with read-only tools: `active_sessions`, `recent_work`, `open_loops`, `prior_attempts`, `resume_packet`;
  - `landed mcp install|remove claude|codex` through each agent's own CLI.
- Packaging: `landed-agents` on npm (0.3.0 was published by hand and staged for npm review). Later releases go through `.github/workflows/release.yml` on a `v*.*.*` tag, using npm Trusted Publishing (OIDC, no token); see docs/releasing.md. Beta tester guide: docs/beta.md.
- Now: dogfooding (PRD Phase 13), with findings and metrics logged daily in `docs/dogfood.md`. Then the §26 validation gates before v1-Team. Implement phases in order. Each phase leaves lint, typecheck, and tests green.

## Commands

```bash
pnpm install        # pnpm comes from corepack (packageManager pins the version)
pnpm lint           # biome + package-boundary check (scripts/check-boundaries.mjs)
pnpm format         # biome autofix
pnpm typecheck      # tsc over all packages, no emit
pnpm test           # vitest, tests colocated as src/**/*.test.ts
pnpm --filter @landed/db db:generate   # after editing packages/db/src/schema.ts
pnpm build          # web UI + bundled CLI (apps/cli/dist/landed.mjs, with migrations and web/)
pnpm landed scan    # run the built CLI; `pnpm landed open` serves http://127.0.0.1:47831
cd apps/cli && pnpm pack   # the npm package `landed-agents` (see docs/releasing.md)
```

## Layout and boundaries

```text
apps/      cli, server (local API; collector daemon in v0.2), web
packages/  shared → core → { db, importer-claude, importer-codex, git-index, outcomes,
                             threads, loops, insights, brief, summarizer }
           ingest = db + importer-* + git-index + outcomes + threads + loops + insights
                    (scan, outcome and analysis pipelines both apps reuse)
apps/cli embeds apps/server; apps/web talks to it over /v1
apps/cli is published to npm as `landed-agents` (Apache-2.0); bins: `landed`, `landed-agents`
```

- `shared`: isomorphic utilities with no internal dependencies.
- `core`: domain types and schemas.
  - `@landed/core` is isomorphic (enums and Zod schemas), so the web app can import it.
  - `@landed/core/fingerprint` is Node-only (uses `node:crypto`). Never import it from `apps/web`.
- Domain packages depend only on `core` and `shared`. There are two exceptions:
  - `outcomes` may also use `git-index`.
  - `ingest` composes `db` with the importers and the analysis packages.
- Only `apps/server` and `apps/cli` wire everything together.
- Importers are pure line parsers that implement `SourceFileParser` from `@landed/core`. They never touch the database. Vendor formats are documented in `docs/sources.md`.
- `scripts/check-boundaries.mjs` enforces these rules in `pnpm lint`. When you add a package, register it in its `ALLOWED` map.
- Workspace packages export TypeScript source directly (`"exports": "./src/index.ts"`). There is no build step yet.

## Conventions

- Entity schemas use `z.strictObject`: unknown keys are rejected, so raw vendor fields can never reach storage. Cross-field invariants go in `superRefine` and get a test.
- Types are inferred from schemas: `XSchema` produces `type X = z.infer<typeof XSchema>`.
- Timestamps are ISO-8601 with an explicit offset (`TimestampSchema`). Ids are ULIDs (`newUlid` from `@landed/shared`).
- Every user-facing claim carries a `Provenance`: observed, derived, inferred, or generated.
- Biome formatting: 2 spaces, double quotes, 100 columns. Run `pnpm format` before finishing.

## Engineering constraints (PRD §28 — non-negotiable)

1. v0.1 never writes to vendor config, vendor session files, git repos, or user files.
2. Never persist code line text, prompt text, tool output, or environment values by default. Store fingerprints only.
3. Stream vendor files. Never load an entire file into memory.
4. Never assume any vendor field exists. Unknown is a valid state everywhere.
5. Never put UI logic on vendor payloads. Vendor-specific code lives only in `importer-*` (and later adapter) packages. The literals `"claude-code"` and `"codex"` are allowed only in `core` and `importer-*`.
6. Never claim authorship from git state alone. Outcomes require patch evidence.
7. Never sum Claude usage without `message.id` deduplication. Never sum Codex cumulative token totals.
8. Never show an agent comparison without the PRD §12.6 controls.
9. Never claim exact cost from incomplete usage.
10. Run git with argument arrays, read-only subcommands, and timeouts.
11. Bind only to loopback, and check Host/Origin.
12. No cloud infrastructure in v0.1–v0.3.
13. Add fixtures and tests with every parser behavior. Add golden git tests with every outcome rule change, and bump `engineVersion`.
14. Prefer small vertical slices. Update `docs/` when contracts change.
15. From v0.2 on: parse, merge, back up, and atomically write any vendor config. Preserve unrelated entries, and keep uninstall reversible.

## Things that bite

- pnpm 12 enforces a minimum release age for dependencies. Do not add `minimumReleaseAgeExclude` entries. Pick an older version instead.
- TypeScript 7 (native compiler) is used for typechecking only. Vitest transpiles on its own.
- `packages/db`: never hand-edit `migrations/`. Change `schema.ts`, run `db:generate`, and commit both. CI fails on drift.
- `exactOptionalPropertyTypes` is on. When mapping DB rows to domain objects, use `compact()` from `packages/db/src/time.ts` rather than assigning `undefined`.
- Fixtures built from real vendor files must be sanitized: replace code with placeholders, remove prompts and secrets.
  - Plant `CANARY_` strings in anything that must never be stored. Tests assert none reaches parser output or the DB.
- Real-data check: `LANDED_REAL_DATA=1 pnpm vitest run packages/ingest/src/smoke.real.test.ts`. It reads the machine's history read-only, writes to a temp DB, and prints counts only. Run it after parser changes.
- Usage keys and vendor ids must be unique across sessions: the pipeline drops anything another session already owns. That is how history copied into resumed or forked sessions is handled.
- Outcome rules: any change needs golden-test updates and an `ENGINE_VERSION` bump.
- Web UI: never branch on vendor names. Derive provider lists from `AgentProviderSchema` and display names generically.
- Server: every state-changing route needs the `x-landed-token` header, and every route goes through the Host/Origin guard. Don't add exemptions.
  - The one deliberate exception is `/v1/ingest/*`. It accepts only the persistent `x-landed-ingest` token, used by agent hooks.
- Hooks: they must never block or steer an agent.
  - Respond `{}` at once and do the work asynchronously.
  - Use timeouts of 2 s or less, and keep the relay silent with exit code 0.
  - Codex hooks are appended at the end of each event's list, never inserted, so the user's trust approvals stay valid.
- MCP (`apps/server/src/mcp.ts`, `memory.ts`): tools only read, and the connection is `query_only`.
  - Every result goes through `privacyFilter`.
  - Never return absolute paths, prompts or code.
  - Nothing but protocol messages may reach stdout in `landed mcp`.
- Vendor config changes (plugin, hooks, MCP registration, LaunchAgent) only happen through explicit `landed … --yes` commands, which preview first. Never run them on a developer's machine without asking.
- Releases: keep `apps/cli/package.json` version and `VERSION` in `apps/cli/src/main.ts` equal (a test checks). Runtime dependencies are only the esbuild externals; workspace packages are devDependencies because they are bundled.
- `landed uninstall` must reverse every integration Landed can add. When you add one, register it in `apps/cli/src/uninstall.ts`.
- `@landed/core` is imported by the web app, so never add Node imports there. Node-only code goes in `@landed/core/fingerprint` or in a package.
