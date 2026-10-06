import {
  CLAUDE_PARSER_VERSION,
  CLAUDE_PROVIDER,
  createClaudeParser,
  defaultClaudeProjectsRoot,
  listClaudeTranscripts,
} from "@landed/importer-claude";
import type { SourceImporter } from "./pipeline";

export const claudeImporter: SourceImporter = {
  provider: CLAUDE_PROVIDER,
  parserVersion: CLAUDE_PARSER_VERSION,
  listFiles: listClaudeTranscripts,
  createParser: createClaudeParser,
};

export { defaultClaudeProjectsRoot };
