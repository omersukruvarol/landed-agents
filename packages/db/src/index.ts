export { type DatabaseHandle, type LandedDb, type OpenOptions, openDatabase } from "./connection";
export {
  DATA_DIR_MODE,
  DATA_FILE_MODE,
  databasePath,
  ensureDataDir,
  resolveDataDir,
} from "./paths";
export {
  allSessionsForAnalysis,
  type CollisionRecord,
  dismissInsight,
  type FailureGroup,
  failureGroups,
  getThread,
  type InsightRecord,
  listCollisions,
  listInsights,
  listOpenLoops,
  listThreads,
  type OpenLoopRecord,
  replaceCollisions,
  replaceThreads,
  setOpenLoopState,
  syncInsights,
  syncOpenLoops,
  type ThreadFilter,
} from "./repositories/analysis";
export {
  countSessionEvents,
  deleteEventsBySourceFile,
  type EventFilter,
  type InsertResult,
  insertEvents,
  latestSessionEvents,
  listEvents,
  type SessionEventCounts,
} from "./repositories/events";
export {
  countIngestionFailures,
  type IngestionFailureInput,
  MAX_FAILURE_MESSAGE,
  recordIngestionFailure,
} from "./repositories/failures";
export { pruneSessions } from "./repositories/maintenance";
export {
  type DistributionFilter,
  listOutcomes,
  type OutcomeFilter,
  outcomeDistribution,
  outcomeSubjectKey,
  type RepoOutcomeCheck,
  setRepoOutcomeCheck,
  upsertOutcomes,
} from "./repositories/outcomes";
export {
  type EventOwner,
  findEventOwners,
  findIdlessEventOwners,
  findPatchOwners,
  findUsageOwners,
  type IdlessEventOwner,
  type PatchOwner,
  sessionEventSpan,
  type UsageOwner,
} from "./repositories/owners";
export {
  countSessionChangedFiles,
  deletePatchesBySourceFile,
  insertPatches,
  listPatches,
  type PatchFilter,
  patchKey,
} from "./repositories/patches";
export {
  getRepo,
  getRepoByRoot,
  listRepos,
  markRepoMissing,
  type RepoInput,
  type RepoRow,
  upsertRepo,
} from "./repositories/repos";
export {
  getSession,
  getSessionByProviderId,
  listSessions,
  type SessionFilter,
  type SessionInput,
  setSessionOutcomeSummary,
  upsertSession,
} from "./repositories/sessions";
export { getSetting, setSetting } from "./repositories/settings";
export {
  type Checkpoint,
  getCheckpoint,
  listSources,
  markSourceScanned,
  type SourceRow,
  saveCheckpoint,
  upsertSource,
} from "./repositories/sources";
export {
  insertUsageRecords,
  sessionUsageTotals,
  type UsageRecordInput,
  UsageRecordInputSchema,
  type UsageTotals,
} from "./repositories/usage";
export * as schema from "./schema";
