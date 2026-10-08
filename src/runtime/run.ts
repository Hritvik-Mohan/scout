import { randomUUID } from "node:crypto";

import type { AgentId } from "../models/enums.js";
import type { RunRow } from "../models/tracker.js";
import type { TrackerRepository } from "../tracker/repository.js";
import { createStructuredLogger, type StructuredLogger } from "./logger.js";
import { classifyRetry } from "./retry.js";

export interface AgentExecutionContext {
  runId: string;
  correlationId: string;
  dryRun: boolean;
}

export interface AgentWorkResult {
  status: "success" | "partial" | "skipped";
  leadsProcessed: number;
  leadIds: readonly string[];
  llmModel?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  error?: string | null;
}

export interface PipelineAgent {
  readonly id: AgentId;
  execute(context: AgentExecutionContext): Promise<AgentWorkResult>;
}

export interface RunClock {
  now(): Date;
}

export interface RunIdentifiers {
  runId: string;
  correlationId: string;
}

export interface ExecuteAgentRunOptions {
  agent: PipelineAgent;
  tracker: Pick<TrackerRepository, "appendRun">;
  trigger: string;
  dryRun: boolean;
  logger?: StructuredLogger;
  clock?: RunClock;
  identifiers?: RunIdentifiers;
}

const systemClock: RunClock = { now: () => new Date() };

function failureMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Unknown agent failure";
  const normalized = error.message.replaceAll(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized.slice(0, 500) : error.name;
}

export async function executeAgentRun(
  options: ExecuteAgentRunOptions,
): Promise<RunRow> {
  const logger = options.logger ?? createStructuredLogger();
  const clock = options.clock ?? systemClock;
  const identifiers = options.identifiers ?? {
    runId: randomUUID(),
    correlationId: randomUUID(),
  };
  const started = clock.now().toISOString();
  const context: AgentExecutionContext = {
    ...identifiers,
    dryRun: options.dryRun,
  };

  logger.info({
    event: "run_started",
    agent: options.agent.id,
    trigger: options.trigger,
    dryRun: options.dryRun,
    ...identifiers,
  });

  let row: RunRow;
  try {
    const result = await options.agent.execute(context);
    row = {
      runId: identifiers.runId,
      agent: options.agent.id,
      started,
      finished: clock.now().toISOString(),
      status: result.status,
      leadsProcessed: result.leadsProcessed,
      leadIds: [...result.leadIds],
      llmModel: result.llmModel ?? null,
      inputTokens: result.inputTokens ?? 0,
      outputTokens: result.outputTokens ?? 0,
      error: result.error ?? null,
      dryRun: options.dryRun,
      trigger: options.trigger,
      correlationId: identifiers.correlationId,
    };
  } catch (error) {
    const retry = classifyRetry(error);
    row = {
      runId: identifiers.runId,
      agent: options.agent.id,
      started,
      finished: clock.now().toISOString(),
      status: "failed",
      leadsProcessed: 0,
      leadIds: [],
      llmModel: null,
      inputTokens: 0,
      outputTokens: 0,
      error: failureMessage(error),
      dryRun: options.dryRun,
      trigger: options.trigger,
      correlationId: identifiers.correlationId,
    };
    logger.error({
      event: "run_finished",
      agent: options.agent.id,
      trigger: options.trigger,
      dryRun: options.dryRun,
      status: "failed",
      retry: retry.retry,
      retryReason: retry.reason,
      errorName: error instanceof Error ? error.name : "UnknownError",
      ...identifiers,
    });
  }

  try {
    await options.tracker.appendRun(row, identifiers.runId);
  } catch (error) {
    logger.error({
      event: "run_record_failed",
      agent: options.agent.id,
      trigger: options.trigger,
      dryRun: options.dryRun,
      status: row.status,
      errorName: error instanceof Error ? error.name : "UnknownError",
      ...identifiers,
    });
    throw error;
  }

  if (row.status !== "failed") {
    logger.info({
      event: "run_finished",
      agent: options.agent.id,
      trigger: options.trigger,
      dryRun: options.dryRun,
      status: row.status,
      ...identifiers,
    });
  }
  return row;
}
