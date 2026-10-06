# Releasing `landed-agents`

The npm package is `apps/cli`. It contains:
- one bundled file, `dist/landed.mjs`;
- the SQL migrations and the built web UI;
- the README and LICENSE, copied in by `build.mjs`.

Its only runtime dependencies are `better-sqlite3`, `fastify` and `@fastify/static`. The workspace packages are bundled in.

## How a release works

Releases are built and **staged** by GitHub Actions (`.github/workflows/release.yml`) when a `v*.*.*` tag is pushed. A staged version goes live only after the owner approves it with 2FA, so a compromised CI run alone can never publish.
- **Authentication:** npm Trusted Publishing (OIDC). There is no npm token anywhere in the repository or its secrets.
- **Provenance:** npm attaches it automatically, so every version on npmjs.com links to the exact commit and workflow run that built it.

### One-time setup

This is done by the owner on npmjs.com, under **landed-agents → Settings → Trusted Publisher → GitHub Actions**:

| Field | Value |
|---|---|
| Organization or user | `omersukruvarol` |
| Repository | `landed-agents` |
| Workflow filename | `release.yml` |
| Environment | leave empty |
| Allowed actions | leave **Allow npm publish** and **Allow npm dist-tag** unchecked; staging is always allowed |

After that, consider setting **Publishing access** to "Require two-factor authentication and disallow tokens". Trusted publishing keeps working with that setting.

### Each release

1. **Bump the version** in `apps/cli/package.json` and `VERSION` in `apps/cli/src/main.ts`. A unit test fails when the two differ, and the workflow refuses a tag that matches neither.
2. **Commit and push** to `main`, and wait for CI to pass.
3. **Tag and push the tag:**

   ```bash
   git tag v0.3.1 && git push origin v0.3.1
   ```

4. **The workflow then:**
   - checks the tag against both versions;
   - runs lint, typecheck, tests and the migration drift check;
   - builds the web UI and CLI;
   - packs the tarball;
   - installs and smokes the tarball;
   - stages that exact tarball with `npm stage publish`.

   A pre-release such as `v0.4.0-beta.1` is published under the `next` dist-tag, never `latest`.

5. **Approve the staged version** on npmjs.com, or from a terminal logged in to npm (npm 12 or newer):

   ```bash
   npm stage list landed-agents
   ```

   ```bash
   npm stage approve <stage-id>
   ```

   Use `npm stage reject <stage-id>` to drop it instead. Only after approval is the version installable.

A published version cannot be removed after 72 hours, and its number can never be reused. Fix mistakes with a new patch version.

## Local install test (before tagging)

`prepack` rebuilds the CLI and refuses to pack without the web UI.

```bash
pnpm build
```

```bash
cd apps/cli && pnpm pack
```

Install the tarball in an isolated home, so nothing touches your machine:

```bash
T=$(mktemp -d) && npm install -g --prefix "$T/prefix" ./landed-agents-<version>.tgz
```

```bash
HOME="$T" LANDED_DATA_DIR="$T/data" "$T/prefix/bin/landed" doctor
```

Then check `scan`, `serve` with `/v1/health`, `mcp`, and `uninstall --yes` the same way. Point `CLAUDE_CONFIG_DIR` and `CODEX_HOME` at fixture copies, or at nothing.

## Manual publish (fallback)

Only if the workflow cannot be used. It needs `npm login`; npm may stage the release for review before it goes live.

```bash
cd apps/cli && pnpm publish --no-git-checks
```

## Notes

- `better-sqlite3` ships prebuilt binaries for current Node versions on macOS (arm64 and x64) and Linux. On other platforms, installation compiles it and needs build tools.
- Never publish from a dirty tree: the bundle is built from the working copy.
