# Releasing `landed-agents`

The npm package is `apps/cli`. It contains:
- one bundled file, `dist/landed.mjs`;
- the SQL migrations and the built web UI;
- the README and LICENSE, copied in by `build.mjs`.

Its only runtime dependencies are `better-sqlite3`, `fastify` and `@fastify/static`. The workspace packages are bundled in.

## Steps

1. **Bump the version** in `apps/cli/package.json` and `VERSION` in `apps/cli/src/main.ts`. A test fails when the two differ.
2. **Check:**

   ```bash
   pnpm lint && pnpm typecheck && pnpm test
   ```

3. **Build and pack.** `prepack` rebuilds the CLI and refuses to pack without the web UI.

   ```bash
   pnpm build
   ```

   ```bash
   cd apps/cli && pnpm pack
   ```

4. **Install test** in an isolated home, so nothing touches your machine:

   ```bash
   T=$(mktemp -d) && npm install -g --prefix "$T/prefix" ./landed-agents-<version>.tgz
   ```

   ```bash
   HOME="$T" LANDED_DATA_DIR="$T/data" "$T/prefix/bin/landed" doctor
   ```

   Then check `scan`, `serve` with `/v1/health`, `mcp`, and `uninstall --yes` the same way. Point `CLAUDE_CONFIG_DIR` and `CODEX_HOME` at fixture copies, or at nothing.

5. **Publish.** This needs your npm account (`npm login`). It is public and cannot be undone after 72 hours.

   ```bash
   cd apps/cli && pnpm publish --no-git-checks
   ```

6. **Tag** the commit `v<version>`.

## Notes

- `better-sqlite3` ships prebuilt binaries for current Node versions on macOS (arm64 and x64) and Linux. On other platforms, installation compiles it and needs build tools.
- Never publish from a dirty tree: the bundle is built from the working copy.
