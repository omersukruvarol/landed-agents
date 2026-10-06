# Claude Code transcript fixtures (2.1.x)

Hand-written lines that mirror the structure of real Claude Code 2.1.281 transcripts. See
`docs/sources.md` for the inventory they are based on. All content is synthetic.

- `{{REPO}}` is replaced at test time with a temporary git repository path.
- Every string that must never reach storage contains `CANARY_`. Tests assert that no `CANARY_`
  string appears in parser output or in the database. File paths and sanitized commands are
  allowed through by design. The one exception is a secret inside a Bash command, which must be
  removed by redaction (and a second command line, which must be dropped).
