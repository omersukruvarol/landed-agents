import { afterEach, describe, expect, it, vi } from "vitest";
import { installMcp, mcpRegistration, removeMcp } from "./mcp";

afterEach(() => vi.restoreAllMocks());

function recorder() {
  const calls: [string, string[]][] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  return { calls, run: (cmd: string, args: string[]) => void calls.push([cmd, args]) };
}

describe("MCP registration", () => {
  it("previews without --yes and changes nothing", () => {
    const { calls, run } = recorder();
    expect(installMcp("claude", { run })).toBe(0);
    expect(calls).toEqual([]);
  });

  it("registers a user-scoped stdio server through each agent's own CLI", () => {
    const { calls, run } = recorder();
    installMcp("claude", { yes: true, run });
    expect(calls[0]).toEqual(["claude", ["mcp", "remove", "--scope", "user", "landed"]]);
    const [cli, args] = calls[1] ?? [];
    expect(cli).toBe("claude");
    expect(args?.slice(0, 6)).toEqual(["mcp", "add", "--scope", "user", "landed", "--"]);
    expect(args?.at(-1)).toBe("mcp");

    const codex = mcpRegistration("codex", ["/bin/node", "/x/landed.mjs", "mcp"]);
    expect(codex?.add).toEqual(["mcp", "add", "landed", "--", "/bin/node", "/x/landed.mjs", "mcp"]);
  });

  it("re-installs over an existing registration and removes cleanly", () => {
    const calls: string[][] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const run = (_: string, args: string[]) => {
      calls.push(args);
      if (args[1] === "remove") throw new Error("not found");
    };
    expect(installMcp("codex", { yes: true, run })).toBe(0);
    expect(calls.map((a) => a[1])).toEqual(["remove", "add"]);
    expect(removeMcp("codex", { run })).toBe(0);
  });

  it("rejects unknown agents", () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(() => installMcp("cursor", { yes: true, run: () => {} })).toThrow(/landed mcp install/);
  });
});
