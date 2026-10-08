export const serviceIdentity = {
  name: "scout",
  version: 1,
  externalActionsEnabled: false,
  prospectSendingEnabled: false,
  linkedInAutomationEnabled: false,
} as const;

export * from "./agents/a0.js";
export * from "./agents/a1-codex.js";
export * from "./agents/a2-codex.js";
export {
  ConfigError,
  loadConfig,
  redactEnvironment,
  toMinutes,
  type AppConfig,
  type ConfigIssue,
} from "./config.js";
export * from "./core/business-days.js";
export * from "./core/caps.js";
export * from "./core/dedup.js";
export * from "./core/dnc.js";
export * from "./core/draft-checks.js";
export * from "./core/evidence.js";
export * from "./core/knowledge.js";
export * from "./core/outbound-policy.js";
export * from "./core/stages.js";
export * from "./discovery/contracts.js";
export * from "./discovery/gdelt.js";
export * from "./discovery/http.js";
export * from "./discovery/rss.js";
export * from "./evaluation/a1.js";
export * from "./integrations/google-auth.js";
export * from "./integrations/google-sheets.js";
export * from "./llm/schemas/agents.js";
export * from "./models/common.js";
export * from "./models/enums.js";
export * from "./models/fixtures.js";
export * from "./models/tracker.js";
export * from "./profiles/loader.js";
export * from "./profiles/schema.js";
export * from "./profiles/scorer.js";
export * from "./runtime/logger.js";
export * from "./runtime/retry.js";
export * from "./runtime/run.js";
export * from "./runtime/write-router.js";
export {
  buildPhaseZeroSchedules,
  getZonedParts,
  isWithinWorkingWindow,
  type AgentSchedule,
  type ScheduleTrigger,
} from "./scheduler/schedules.js";
export * from "./tracker/memory.js";
export * from "./tracker/repository.js";
