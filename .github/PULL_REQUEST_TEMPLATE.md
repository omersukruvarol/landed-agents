**What and why**

**How it was tested**

**Checklist**
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass.
- [ ] Nothing new persists prompt text, code lines, tool output or environment values.
- [ ] Parser changes come with sanitized fixtures; outcome rule changes come with golden tests and an `ENGINE_VERSION` bump.
- [ ] `docs/` is updated if a contract changed.
