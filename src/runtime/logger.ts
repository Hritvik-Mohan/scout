import pino from "pino";

import type { AgentId } from "../models/enums.js";
import type { RunRow } from "../models/tracker.js";

export interface RunLogEvent {
  event: "run_started" | "run_finished" | "run_record_failed";
  runId: string;
  correlationId: string;
  agent: AgentId;
  trigger: string;
  dryRun: boolean;
  status?: RunRow["status"];
  retry?: boolean;
  retryReason?: string;
  errorName?: string;
}

export interface StructuredLogger {
  info(event: RunLogEvent): void;
  error(event: RunLogEvent): void;
}

export function createStructuredLogger(): StructuredLogger {
  const logger = pino({
    base: { service: "scout" },
    redact: {
      paths: ["*.token", "*.secret", "*.password", "*.credential"],
      censor: "[REDACTED]",
    },
  });
  return {
    info: (event) => logger.info(event),
    error: (event) => logger.error(event),
  };
}
