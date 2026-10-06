/**
 * Defense-in-depth secret redaction for display strings (PRD §23). Not a guarantee: the UI must
 * still communicate that commands and paths can be sensitive.
 */
export const REDACTED = "[REDACTED]";

interface Rule {
  pattern: RegExp;
  replace: string;
}

const SECRET_NAME =
  "[A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|CREDENTIALS?)[A-Za-z0-9_]*";

// Order matters: whole blocks and structured forms before generic token shapes.
const RULES: Rule[] = [
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    replace: REDACTED,
  },
  {
    pattern: /\b(authorization\s*[:=]\s*)(?:(?:bearer|basic|token)\s+)?[^\s'"]+/gi,
    replace: `$1${REDACTED}`,
  },
  { pattern: /\b(bearer\s+)[A-Za-z0-9._~+/-]{8,}=*/gi, replace: `$1${REDACTED}` },
  { pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@'"]+:[^/\s@'"]+@/gi, replace: `$1${REDACTED}@` },
  {
    pattern: new RegExp(String.raw`\b(${SECRET_NAME})(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s'"]+)`, "gi"),
    replace: `$1$2${REDACTED}`,
  },
  {
    pattern: /(--?(?:password|passwd|pass|token|api-?key|secret)(?:=|\s+))("[^"]*"|'[^']*'|\S+)/gi,
    replace: `$1${REDACTED}`,
  },
  { pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g, replace: REDACTED },
  {
    pattern: /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/g,
    replace: REDACTED,
  },
  { pattern: /\bglpat-[A-Za-z0-9_-]{20,}/g, replace: REDACTED },
  { pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, replace: REDACTED },
  { pattern: /\bnpm_[A-Za-z0-9]{30,}/g, replace: REDACTED },
  { pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replace: REDACTED },
  { pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, replace: REDACTED },
  { pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, replace: REDACTED },
];

export interface RedactionResult {
  text: string;
  redactions: number;
}

export function redactSecrets(input: string): RedactionResult {
  let text = input;
  let redactions = 0;
  for (const { pattern, replace } of RULES) {
    const matches = text.match(pattern); // every rule is global, so this counts all matches
    if (!matches) continue;
    redactions += matches.length;
    text = text.replace(pattern, replace);
  }
  return { text, redactions };
}

/** Longest display form kept for a command, in code points. */
export const MAX_COMMAND_DISPLAY = 300;

const PREFIX_WORDS = new Set(["sudo", "env", "time", "nohup", "exec", "command", "builtin"]);
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

export interface SanitizedCommand {
  /** Program name of the first meaningful segment, e.g. "pnpm" for `cd app && pnpm test`. */
  executable?: string;
  /** First line only, secrets redacted, quoted prose masked, length-capped. */
  display: string;
  redactions: number;
}

/** Replaces quoted prose (commit messages, prompts handed to nested CLIs, echo text) in a command. */
export const MASKED_TEXT = "[TEXT]";
const QUOTED = /(["'])((?:\\.|(?!\1).)*)\1/g;
const MAX_KEPT_QUOTED = 48;

function maskQuotedProse(command: string): { text: string; masked: number } {
  let masked = 0;
  const text = command.replace(QUOTED, (whole, quote: string, body: string) => {
    const words = body.trim().split(/\s+/).filter(Boolean).length;
    if (words < 3 && body.length <= MAX_KEPT_QUOTED) return whole;
    masked++;
    return `${quote}${MASKED_TEXT}${quote}`;
  });
  return { text, masked };
}

export function sanitizeCommand(command: string): SanitizedCommand {
  const firstLine = command.trim().split(/\r?\n/, 1)[0] ?? "";
  const secretsRemoved = redactSecrets(firstLine);
  const prose = maskQuotedProse(secretsRemoved.text);
  const text = prose.text;
  const redactions = secretsRemoved.redactions + prose.masked;
  const chars = [...text];
  const display =
    chars.length > MAX_COMMAND_DISPLAY
      ? `${chars.slice(0, MAX_COMMAND_DISPLAY - 1).join("")}…`
      : text;
  const executable = commandExecutable(text);
  return executable === undefined ? { display, redactions } : { executable, display, redactions };
}

function commandExecutable(command: string): string | undefined {
  for (const segment of command.split(/&&|\|\||;|\|/)) {
    const words = segment
      .trim()
      .split(/\s+/)
      .map((w) => w.replace(/^['"(]+|['")]+$/g, ""))
      .filter(Boolean);
    const word = words.find((w) => !ENV_ASSIGNMENT.test(w) && !PREFIX_WORDS.has(w));
    if (word === undefined || word === "cd") continue;
    const base = word.split("/").pop();
    if (base && base !== REDACTED) return base;
  }
  return undefined;
}
