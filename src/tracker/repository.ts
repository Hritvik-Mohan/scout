import type {
  DoNotContactRow,
  DryRunOutputRow,
  PIPELINE_HEADERS,
  PipelineLead,
  RunRow,
  SourceRow,
} from "../models/tracker.js";

export type PipelineHeader = (typeof PIPELINE_HEADERS)[number];

export const HUMAN_ONLY_PIPELINE_HEADERS = [
  "Email / LinkedIn",
  "Notes",
  "Approved",
] as const satisfies readonly PipelineHeader[];

export const IMMUTABLE_PIPELINE_HEADERS = [
  "Lead ID",
] as const satisfies readonly PipelineHeader[];

export interface ProposedLeadWrite {
  idempotencyKey: string;
  leadId: string;
  changes: Partial<Record<PipelineHeader, unknown>>;
}

export interface IdempotentWriteResult {
  outcome: "applied" | "replayed";
}

export interface HeaderDiscovery {
  indexes: ReadonlyMap<PipelineHeader, number>;
  headers: readonly string[];
}

export interface AcquireLockRequest {
  leadId: string;
  token: string;
  acquiredAt: string;
  staleAfterMs?: number;
}

export interface AcquireLockResult {
  outcome: "acquired" | "already_locked" | "taken_over";
  previousToken?: string;
}

export interface LockEvent {
  leadId: string;
  token: string;
  occurredAt: string;
  type: "acquired" | "released" | "taken_over";
  previousToken?: string;
}

export interface TrackerRepository {
  discoverPipelineHeaders(): Promise<HeaderDiscovery>;
  listLeads(): Promise<readonly PipelineLead[]>;
  listSources(): Promise<readonly SourceRow[]>;
  listDoNotContact(): Promise<readonly DoNotContactRow[]>;
  proposeLeadWrite(write: ProposedLeadWrite): Promise<IdempotentWriteResult>;
  appendRun(
    run: RunRow,
    idempotencyKey: string,
  ): Promise<IdempotentWriteResult>;
  listRuns(): Promise<readonly RunRow[]>;
  appendDryRunOutput(
    output: DryRunOutputRow,
    idempotencyKey: string,
  ): Promise<IdempotentWriteResult>;
  listDryRunOutputs(): Promise<readonly DryRunOutputRow[]>;
  acquireLeadLock(request: AcquireLockRequest): Promise<AcquireLockResult>;
  releaseLeadLock(
    leadId: string,
    token: string,
    releasedAt: string,
  ): Promise<boolean>;
  allocateLeadId(date: string, idempotencyKey: string): Promise<string>;
}

export class TrackerSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrackerSchemaError";
  }
}

export class TrackerWriteError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TrackerWriteError";
  }
}
