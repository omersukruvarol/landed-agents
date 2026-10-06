import {
  CODEX_PARSER_VERSION,
  CODEX_PROVIDER,
  createCodexParser,
  defaultCodexSessionsRoot,
  listCodexRollouts,
} from "@landed/importer-codex";
import type { SourceImporter } from "./pipeline";

export const codexImporter: SourceImporter = {
  provider: CODEX_PROVIDER,
  parserVersion: CODEX_PARSER_VERSION,
  listFiles: listCodexRollouts,
  createParser: createCodexParser,
};

export { defaultCodexSessionsRoot };
