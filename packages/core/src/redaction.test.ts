import { describe, expect, it } from "vitest";
import {
  MASKED_TEXT,
  MAX_COMMAND_DISPLAY,
  REDACTED,
  redactSecrets,
  sanitizeCommand,
} from "./redaction";

describe("redactSecrets", () => {
  it.each([
    ["auth header", `curl -H "Authorization: Bearer abcdef123456" https://api.x`, "abcdef123456"],
    ["bare bearer", "Bearer eyJhbGciOiJIUzI1.abc", "eyJhbGciOiJIUzI1"],
    ["url credentials", "git clone https://user:hunter2@github.com/o/r.git", "hunter2"],
    ["env secret", "OPENAI_API_KEY=sk-abc123 node run.js", "sk-abc123"],
    ["quoted env secret", `export DB_PASSWORD="p@ss w0rd"`, "p@ss w0rd"],
    ["password flag", "mysql --password=s3cret -u root", "s3cret"],
    ["anthropic key", "echo sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA", "sk-ant-api03-AAAA"],
    [
      "github token",
      "gh auth login --with-token ghp_abcdefghijklmnopqrstuvwxyz0123",
      "ghp_abcdefghij",
    ],
    [
      "aws key id",
      "aws configure set aws_access_key_id AKIAIOSFODNN7EXAMPLE",
      "AKIAIOSFODNN7EXAMPLE",
    ],
    ["slack token", "SLACK=xoxb-1234567890-abcdefghij", "xoxb-1234567890"],
    [
      "jwt",
      "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
      "eyJzdWIi",
    ],
    [
      "private key",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----",
      "MIIEow",
    ],
  ])("redacts %s", (_label, input, secret) => {
    const r = redactSecrets(input);
    expect(r.text).not.toContain(secret);
    expect(r.text).toContain(REDACTED);
    expect(r.redactions).toBeGreaterThan(0);
  });

  it.each([
    "mkdir -p src/components",
    "git commit -m 'fix: token refresh race'",
    "pnpm test -- --reporter=dot",
    "grep -rn useToken src/",
    "ls -la ~/.ssh",
  ])("leaves ordinary commands alone: %s", (cmd) => {
    expect(redactSecrets(cmd)).toEqual({ text: cmd, redactions: 0 });
  });

  it("counts every redaction", () => {
    expect(redactSecrets("A_TOKEN=x B_SECRET=y").redactions).toBe(2);
  });
});

describe("sanitizeCommand", () => {
  it.each([
    ["pnpm test", "pnpm"],
    ["cd apps/web && pnpm build", "pnpm"],
    ["NODE_ENV=test FOO=1 vitest run", "vitest"],
    ["sudo /usr/bin/git status", "git"],
    ["  (cd x; make all)", "make"],
    ["cat a.txt | grep b", "cat"],
  ])("finds the executable of %j", (cmd, exe) => {
    expect(sanitizeCommand(cmd).executable).toBe(exe);
  });

  it("keeps only the first line and redacts it", () => {
    const r = sanitizeCommand("GITHUB_TOKEN=abc gh pr create\nsecond line with body");
    expect(r.display).toBe(`GITHUB_TOKEN=${REDACTED} gh pr create`);
    expect(r.executable).toBe("gh");
    expect(r.redactions).toBe(1);
  });

  it("caps the display length", () => {
    const r = sanitizeCommand(`echo ${"x".repeat(1000)}`);
    expect([...r.display]).toHaveLength(MAX_COMMAND_DISPLAY);
    expect(r.display.endsWith("…")).toBe(true);
  });

  it("returns no executable for an empty or cd-only command", () => {
    expect(sanitizeCommand("").executable).toBeUndefined();
    expect(sanitizeCommand("cd /tmp").executable).toBeUndefined();
  });
});

describe("sanitizeCommand — quoted prose", () => {
  it.each([
    [`git commit -m "fix the retry logic for webhooks"`, `git commit -m "${MASKED_TEXT}"`],
    [`codex exec 'Read the plan and implement phase two'`, `codex exec '${MASKED_TEXT}'`],
    [`echo "${"x".repeat(60)}"`, `echo "${MASKED_TEXT}"`],
  ])("masks %j", (cmd, expected) => {
    const r = sanitizeCommand(cmd);
    expect(r.display).toBe(expected);
    expect(r.redactions).toBe(1);
  });

  it.each([
    `grep -rn "useToken" src/`,
    `git checkout -b 'feat/retry'`,
    `rg "export const" packages`,
    `node -e "console.log(1)"`,
  ])("keeps short quoted arguments: %j", (cmd) => {
    expect(sanitizeCommand(cmd)).toMatchObject({ display: cmd, redactions: 0 });
  });

  it("handles escaped quotes inside a quoted string", () => {
    expect(sanitizeCommand(`git commit -m "say \\"hi\\" to the whole team today"`).display).toBe(
      `git commit -m "${MASKED_TEXT}"`,
    );
  });
});
