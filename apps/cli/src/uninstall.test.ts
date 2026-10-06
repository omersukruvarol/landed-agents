import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { integrations, uninstallCommand } from "./uninstall";

afterEach(() => vi.restoreAllMocks());

describe("uninstall", () => {
  it("finds MCP registrations through each agent's own CLI, in removal order", () => {
    const calls: string[] = [];
    const probe = (cmd: string, args: string[]) => {
      calls.push(`${cmd} ${args.join(" ")}`);
      return cmd === "codex";
    };
    const found = integrations(probe, mkdtempSync(join(tmpdir(), "landed-un-")));
    expect(found.map((i) => i.name)).toEqual([
      "Start-at-login LaunchAgent",
      "MCP server registered with Claude Code",
      "MCP server registered with Codex",
      "Claude Code plugin",
      "Codex hooks",
    ]);
    expect(calls).toEqual(["claude mcp get landed", "codex mcp get landed"]);
    expect(found[1]?.present).toBe(false);
    expect(found[2]?.present).toBe(true);
    expect(found[3]?.present).toBe(false); // no plugin folder in this data dir
  });

  it("changes nothing when not confirmed (no --yes, no terminal)", async () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c: string | Uint8Array) => {
      out.push(String(c));
      return true;
    });
    const probe = vi.fn(() => true);
    await uninstallCommand({ probe });
    expect(out.join("")).toContain("Cancelled. Nothing was changed.");
    expect(out.join("")).toContain("MCP server registered with Claude Code");
  });
});
