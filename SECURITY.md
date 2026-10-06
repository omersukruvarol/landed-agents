# Security policy

Landed reads sensitive local data: agent transcripts and git history. It also runs a local HTTP server and, if you opt in, changes agent configuration. We take reports seriously.

## Reporting a vulnerability

Do **not** open a public issue. Instead, report it privately through GitHub: **Security → Report a vulnerability** on this repository.

Please include the version (`landed --version`), your macOS and Node.js versions, and steps to reproduce. Never include real prompts, code or secrets; describe their shape instead.

We aim to acknowledge reports within 3 working days.

## In scope

- **Data leaving the machine:** any path by which prompt text, code lines, tool output or environment values are stored or sent.
- **The local API** (`127.0.0.1:47831`):
  - bypassing the Host/Origin guard or the token checks;
  - DNS rebinding;
  - reading data from another origin.
- **The MCP server** returning absolute paths, secrets or content beyond stored metadata.
- **Unintended writes:** any write to vendor files, vendor config, git repositories or user files, outside the explicit `--yes` install commands.
- **Install and uninstall:** commands that do not preview, are not reversible, or damage existing agent configuration.

## Supported versions

Only the latest release receives fixes during the beta.
