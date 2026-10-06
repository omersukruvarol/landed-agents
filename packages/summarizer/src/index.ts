import { spawn } from "node:child_process";
import { z } from "zod";

/**
 * Optional generated narrative (PRD §18). Off by default. The input is structured, already
 * sanitized facts — never prompts, code or tool output — and the output is validated JSON that the
 * UI labels "Generated". Any failure returns undefined and the deterministic brief stands alone.
 */
export const GeneratedSummarySchema = z.strictObject({
  summary: z.string().min(1).max(1200),
  attention: z.array(z.string().max(300)).max(8).default([]),
});
export type GeneratedSummary = z.infer<typeof GeneratedSummarySchema>;

export interface Summarizer {
  readonly name: string;
  summarizeDay(facts: unknown): Promise<GeneratedSummary | undefined>;
}

export const DAY_PROMPT = `You summarize a developer's day of AI coding-agent activity from structured facts.
Rules: use only the facts given; never invent completion or outcomes; say "unclear" when unsure;
no more than 5 sentences. Reply with JSON only: {"summary": string, "attention": string[]}.
Facts:
`;

export interface CommandSummarizerOptions {
  /** Executable and arguments of a CLI that reads a prompt on stdin and prints a reply. */
  command: string;
  args: string[];
  timeoutMs?: number;
  name?: string;
}

/**
 * Uses an installed agent CLI in non-interactive mode (e.g. `claude -p`), so no new API key is
 * needed. The facts go to that CLI's vendor, which is why this is opt-in.
 */
export function createCommandSummarizer(opts: CommandSummarizerOptions): Summarizer {
  return {
    name: opts.name ?? opts.command,
    async summarizeDay(facts) {
      const reply = await run(
        opts.command,
        opts.args,
        `${DAY_PROMPT}${JSON.stringify(facts)}`,
        opts.timeoutMs ?? 60_000,
      );
      return reply === undefined ? undefined : parseSummary(reply);
    },
  };
}

/** Extracts and validates the JSON object in a model reply. */
export function parseSummary(reply: string): GeneratedSummary | undefined {
  let text = reply.trim();
  try {
    const wrapped = JSON.parse(text);
    if (wrapped && typeof wrapped === "object" && typeof wrapped.result === "string")
      text = wrapped.result;
  } catch {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    const r = GeneratedSummarySchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return r.success ? r.data : undefined;
  } catch {
    return undefined;
  }
}

function run(
  command: string,
  args: string[],
  input: string,
  timeoutMs: number,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let out = "";
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { stdio: ["pipe", "pipe", "ignore"] });
    } catch {
      resolve(undefined);
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(undefined);
    }, timeoutMs);
    child.stdout?.on("data", (d: Buffer) => {
      out += d.toString("utf8");
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(undefined);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? out : undefined);
    });
    child.stdin?.end(input);
  });
}
