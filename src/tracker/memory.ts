import { z } from "zod";

import { isoDateSchema } from "../models/common.js";
import {
  PIPELINE_HEADERS,
  doNotContactRowSchema,
  dryRunOutputRowSchema,
  pipelineLeadSchema,
  runRowSchema,
  sourceRowSchema,
  type DoNotContactRow,
  type DryRunOutputRow,
  type PipelineLead,
  type RunRow,
  type SourceRow,
} from "../models/tracker.js";
import {
  HUMAN_ONLY_PIPELINE_HEADERS,
  IMMUTABLE_PIPELINE_HEADERS,
  TrackerSchemaError,
  TrackerWriteError,
  type AcquireLockRequest,
  type AcquireLockResult,
  type HeaderDiscovery,
  type IdempotentWriteResult,
  type LockEvent,
  type PipelineHeader,
  type ProposedLeadWrite,
  type TrackerRepository,
} from "./repository.js";

const idempotencyKeySchema = z.string().uuid();
const lockTokenSchema = z.string().uuid();
const DEFAULT_STALE_LOCK_MS = 30 * 60 * 1000;

const HEADER_TO_FIELD = {
  Company: "company",
  Website: "website",
  Contact: "contact",
  Role: "role",
  "Email / LinkedIn": "emailOrLinkedIn",
  Source: "source",
  Signal: "signal",
  "Signal date": "signalDate",
  Industry: "industry",
  "Case study": "caseStudy",
  "Fit (1-5)": "fit",
  Package: "package",
  "Est. value (INR L)": "estimatedValueInrLakhs",
  Stage: "stage",
  Channel: "channel",
  Touches: "touches",
  "Last touch": "lastTouch",
  "Next action": "nextAction",
  "Next date": "nextDate",
  Notes: "notes",
  "Lead ID": "leadId",
  Email: "email",
  "LinkedIn URL": "linkedInUrl",
  "Signal URL": "signalUrl",
  "Research summary": "researchSummary",
  "Research sources": "researchSources",
  "Unverified notes": "unverifiedNotes",
  "Draft link": "draftLink",
  "LinkedIn draft": "linkedInDraft",
  "Brief link": "briefLink",
  "Proposal link": "proposalLink",
  "Gmail thread ID": "gmailThreadId",
  "Reply class": "replyClass",
  Approved: "approved",
  "Agent lock": "agentLock",
  "Last agent run": "lastAgentRun",
  Error: "error",
  "Active draft ID": "activeDraftId",
  "Last inbound message ID": "lastInboundMessageId",
  "Last outbound message ID": "lastOutboundMessageId",
  "Evidence JSON link": "evidenceJsonLink",
  "Stage changed at": "stageChangedAt",
  "Stage changed by": "stageChangedBy",
  "Processed transcript file ID": "processedTranscriptFileId",
} as const satisfies Record<PipelineHeader, keyof PipelineLead>;

const NUMBER_HEADERS = new Set<PipelineHeader>([
  "Fit (1-5)",
  "Est. value (INR L)",
  "Touches",
]);
const LIST_HEADERS = new Set<PipelineHeader>([
  "Research sources",
  "Unverified notes",
]);
const BOOLEAN_HEADERS = new Set<PipelineHeader>(["Approved"]);
const PROTECTED_HEADERS = new Set<PipelineHeader>(HUMAN_ONLY_PIPELINE_HEADERS);
const IMMUTABLE_HEADERS = new Set<PipelineHeader>(IMMUTABLE_PIPELINE_HEADERS);

export interface MemoryTrackerSeed {
  headers?: readonly string[];
  rows?: readonly (readonly unknown[])[];
  runs?: readonly RunRow[];
  dryRunOutputs?: readonly DryRunOutputRow[];
  sources?: readonly SourceRow[];
  doNotContact?: readonly DoNotContactRow[];
}

interface ParsedLock {
  token: string;
  acquiredAt: string;
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function parseListCell(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return value;
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseBooleanCell(value: unknown): unknown {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return value;
}

function parseNumberCell(value: unknown): unknown {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const number = Number(value);
    return Number.isNaN(number) ? value : number;
  }
  return value;
}

function normalizeCell(header: PipelineHeader, value: unknown): unknown {
  if (isBlank(value)) return undefined;
  if (LIST_HEADERS.has(header)) return parseListCell(value);
  if (NUMBER_HEADERS.has(header)) return parseNumberCell(value);
  if (BOOLEAN_HEADERS.has(header)) return parseBooleanCell(value);
  return value;
}

function discoverHeaders(headers: readonly string[]): HeaderDiscovery {
  const counts = new Map<string, number>();
  for (const header of headers) {
    counts.set(header, (counts.get(header) ?? 0) + 1);
  }

  const duplicates = [...counts]
    .filter(([, count]) => count > 1)
    .map(([header]) => header);
  const missing = PIPELINE_HEADERS.filter((header) => !counts.has(header));
  if (duplicates.length > 0 || missing.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing: ${missing.join(", ")}`);
    if (duplicates.length > 0) {
      parts.push(`duplicate: ${duplicates.join(", ")}`);
    }
    throw new TrackerSchemaError(
      `Invalid Pipeline headers (${parts.join("; ")})`,
    );
  }

  const indexes = new Map<PipelineHeader, number>();
  for (const header of PIPELINE_HEADERS) {
    indexes.set(header, headers.indexOf(header));
  }
  return { headers: [...headers], indexes };
}

function validateIdempotencyKey(value: string): void {
  if (!idempotencyKeySchema.safeParse(value).success) {
    throw new TrackerWriteError("idempotencyKey must be a UUID");
  }
}

function validateInstant(value: string, field: string): number {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new TrackerWriteError(`${field} must be a valid datetime`);
  }
  return timestamp;
}

function encodeLock(lock: ParsedLock): string {
  return JSON.stringify(lock);
}

function decodeLock(value: unknown): ParsedLock | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "token" in parsed &&
      "acquiredAt" in parsed &&
      typeof parsed.token === "string" &&
      typeof parsed.acquiredAt === "string"
    ) {
      return { token: parsed.token, acquiredAt: parsed.acquiredAt };
    }
  } catch (error) {
    throw new TrackerWriteError("Existing Agent lock is malformed", {
      cause: error,
    });
  }
  throw new TrackerWriteError("Existing Agent lock is malformed");
}

export class InMemoryTrackerRepository implements TrackerRepository {
  readonly lockEvents: LockEvent[] = [];

  private readonly headers: string[];
  private readonly rows: unknown[][];
  private readonly runs: RunRow[];
  private readonly dryRunOutputs: DryRunOutputRow[];
  private readonly sources: SourceRow[];
  private readonly doNotContact: DoNotContactRow[];
  private readonly appliedKeys = new Map<string, string>();
  private readonly allocatedLeadIds = new Map<string, string>();

  constructor(seed: MemoryTrackerSeed = {}) {
    this.headers = [...(seed.headers ?? PIPELINE_HEADERS)];
    this.rows = (seed.rows ?? []).map((row) => [...row]);
    this.runs = (seed.runs ?? []).map((run) => runRowSchema.parse(run));
    this.dryRunOutputs = (seed.dryRunOutputs ?? []).map((output) =>
      dryRunOutputRowSchema.parse(output),
    );
    this.sources = (seed.sources ?? []).map((source) =>
      sourceRowSchema.parse(source),
    );
    this.doNotContact = (seed.doNotContact ?? []).map((entry) =>
      doNotContactRowSchema.parse(entry),
    );
  }

  async discoverPipelineHeaders(): Promise<HeaderDiscovery> {
    return Promise.resolve(discoverHeaders(this.headers));
  }

  async listLeads(): Promise<readonly PipelineLead[]> {
    const discovery = await this.discoverPipelineHeaders();
    const leads = this.rows.map((row, index) =>
      this.parseRow(row, index + 3, discovery),
    );
    this.assertUniqueLeadIds(leads);
    return leads;
  }

  async listSources(): Promise<readonly SourceRow[]> {
    return Promise.resolve(this.sources.map((source) => ({ ...source })));
  }

  async listDoNotContact(): Promise<readonly DoNotContactRow[]> {
    return Promise.resolve(this.doNotContact.map((entry) => ({ ...entry })));
  }

  async proposeLeadWrite(
    write: ProposedLeadWrite,
  ): Promise<IdempotentWriteResult> {
    validateIdempotencyKey(write.idempotencyKey);
    const fingerprint = JSON.stringify([
      "lead_write",
      write.leadId,
      Object.entries(write.changes).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ]);
    if (this.checkReplay(write.idempotencyKey, fingerprint)) {
      return { outcome: "replayed" };
    }

    const headers = Object.keys(write.changes) as PipelineHeader[];
    const protectedHeader = headers.find((header) =>
      PROTECTED_HEADERS.has(header),
    );
    if (protectedHeader !== undefined) {
      throw new TrackerWriteError(
        `Service writes to human-only column ${protectedHeader} are forbidden`,
      );
    }
    const immutableHeader = headers.find((header) =>
      IMMUTABLE_HEADERS.has(header),
    );
    if (immutableHeader !== undefined) {
      throw new TrackerWriteError(
        `Service writes to immutable column ${immutableHeader} are forbidden`,
      );
    }

    const discovery = await this.discoverPipelineHeaders();
    const leads = await this.listLeads();
    const rowIndex = leads.findIndex((lead) => lead.leadId === write.leadId);
    if (rowIndex < 0) {
      throw new TrackerWriteError(`Unknown lead ID ${write.leadId}`);
    }

    const candidate = [...(this.rows[rowIndex] ?? [])];
    for (const [header, value] of Object.entries(write.changes) as [
      PipelineHeader,
      unknown,
    ][]) {
      const columnIndex = discovery.indexes.get(header);
      if (columnIndex === undefined) {
        throw new TrackerSchemaError(`Missing Pipeline header ${header}`);
      }
      candidate[columnIndex] = value;
    }
    this.parseRow(candidate, rowIndex + 3, discovery);
    this.rows[rowIndex] = candidate;
    this.appliedKeys.set(write.idempotencyKey, fingerprint);
    return { outcome: "applied" };
  }

  async appendRun(
    run: RunRow,
    idempotencyKey: string,
  ): Promise<IdempotentWriteResult> {
    validateIdempotencyKey(idempotencyKey);
    const parsed = await runRowSchema.parseAsync(run);
    const fingerprint = JSON.stringify(["run_append", parsed]);
    if (this.checkReplay(idempotencyKey, fingerprint)) {
      return { outcome: "replayed" };
    }
    if (this.runs.some((existing) => existing.runId === parsed.runId)) {
      throw new TrackerWriteError(`Duplicate run ID ${parsed.runId}`);
    }
    this.runs.push(parsed);
    this.appliedKeys.set(idempotencyKey, fingerprint);
    return { outcome: "applied" };
  }

  async listRuns(): Promise<readonly RunRow[]> {
    return Promise.resolve(
      this.runs.map((run) => ({ ...run, leadIds: [...run.leadIds] })),
    );
  }

  async appendDryRunOutput(
    output: DryRunOutputRow,
    idempotencyKey: string,
  ): Promise<IdempotentWriteResult> {
    validateIdempotencyKey(idempotencyKey);
    const parsed = await dryRunOutputRowSchema.parseAsync(output);
    const fingerprint = JSON.stringify(["dry_run_output", parsed]);
    if (this.checkReplay(idempotencyKey, fingerprint)) {
      return { outcome: "replayed" };
    }
    this.dryRunOutputs.push(parsed);
    this.appliedKeys.set(idempotencyKey, fingerprint);
    return { outcome: "applied" };
  }

  async listDryRunOutputs(): Promise<readonly DryRunOutputRow[]> {
    return Promise.resolve(this.dryRunOutputs.map((output) => ({ ...output })));
  }

  async acquireLeadLock(
    request: AcquireLockRequest,
  ): Promise<AcquireLockResult> {
    if (!lockTokenSchema.safeParse(request.token).success) {
      throw new TrackerWriteError("lock token must be a UUID");
    }
    const acquiredAt = validateInstant(request.acquiredAt, "acquiredAt");
    const staleAfterMs = request.staleAfterMs ?? DEFAULT_STALE_LOCK_MS;
    if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs <= 0) {
      throw new TrackerWriteError("staleAfterMs must be a positive integer");
    }

    const discovery = await this.discoverPipelineHeaders();
    const rowIndex = await this.findLeadRowIndex(request.leadId);
    const lockIndex = discovery.indexes.get("Agent lock");
    if (lockIndex === undefined) {
      throw new TrackerSchemaError("Missing Pipeline header Agent lock");
    }
    const existing = decodeLock(this.rows[rowIndex]?.[lockIndex]);
    if (existing !== null) {
      const existingAt = validateInstant(
        existing.acquiredAt,
        "existing lock acquiredAt",
      );
      if (acquiredAt - existingAt <= staleAfterMs) {
        return { outcome: "already_locked" };
      }
    }

    const encoded = encodeLock({
      token: request.token,
      acquiredAt: request.acquiredAt,
    });
    const row = this.rows[rowIndex];
    if (row === undefined) {
      throw new TrackerWriteError(`Unknown lead ID ${request.leadId}`);
    }
    row[lockIndex] = encoded;
    if (decodeLock(row[lockIndex])?.token !== request.token) {
      throw new TrackerWriteError("Lock verification failed");
    }

    const event: LockEvent = {
      leadId: request.leadId,
      token: request.token,
      occurredAt: request.acquiredAt,
      type: existing === null ? "acquired" : "taken_over",
      ...(existing === null ? {} : { previousToken: existing.token }),
    };
    this.lockEvents.push(event);
    return {
      outcome: existing === null ? "acquired" : "taken_over",
      ...(existing === null ? {} : { previousToken: existing.token }),
    };
  }

  async releaseLeadLock(
    leadId: string,
    token: string,
    releasedAt: string,
  ): Promise<boolean> {
    validateInstant(releasedAt, "releasedAt");
    const discovery = await this.discoverPipelineHeaders();
    const rowIndex = await this.findLeadRowIndex(leadId);
    const lockIndex = discovery.indexes.get("Agent lock");
    if (lockIndex === undefined) {
      throw new TrackerSchemaError("Missing Pipeline header Agent lock");
    }
    const row = this.rows[rowIndex];
    if (row === undefined) return false;
    const existing = decodeLock(row[lockIndex]);
    if (existing?.token !== token) return false;
    row[lockIndex] = "";
    this.lockEvents.push({
      leadId,
      token,
      occurredAt: releasedAt,
      type: "released",
    });
    return true;
  }

  async allocateLeadId(date: string, idempotencyKey: string): Promise<string> {
    validateIdempotencyKey(idempotencyKey);
    const cached = this.allocatedLeadIds.get(idempotencyKey);
    if (cached !== undefined) return cached;
    if (!isoDateSchema.safeParse(date).success) {
      throw new TrackerWriteError("date must be a real ISO date");
    }
    const compactDate = date.replaceAll("-", "");
    const [leads, dryRunOutputs] = await Promise.all([
      this.listLeads(),
      this.listDryRunOutputs(),
    ]);
    const reserved = new Set([
      ...leads.map((lead) => lead.leadId),
      ...dryRunOutputs.flatMap((output) =>
        output.leadId === null ? [] : [output.leadId],
      ),
      ...this.allocatedLeadIds.values(),
    ]);
    const sequence =
      Math.max(
        0,
        ...[...reserved]
          .filter((leadId) => leadId.startsWith(`L-${compactDate}-`))
          .map((leadId) => Number(leadId.slice(-3))),
      ) + 1;
    if (sequence > 999) {
      throw new TrackerWriteError(`Lead ID sequence exhausted for ${date}`);
    }
    const leadId = `L-${compactDate}-${sequence.toString().padStart(3, "0")}`;
    this.allocatedLeadIds.set(idempotencyKey, leadId);
    return leadId;
  }

  private parseRow(
    row: readonly unknown[],
    sheetRow: number,
    discovery: HeaderDiscovery,
  ): PipelineLead {
    const candidate: Record<string, unknown> = {};
    for (const header of PIPELINE_HEADERS) {
      const index = discovery.indexes.get(header);
      if (index === undefined) {
        throw new TrackerSchemaError(`Missing Pipeline header ${header}`);
      }
      const value = normalizeCell(header, row[index]);
      if (value !== undefined) {
        candidate[HEADER_TO_FIELD[header]] = value;
      }
    }
    const parsed = pipelineLeadSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new TrackerSchemaError(
        `Invalid Pipeline row ${String(sheetRow)}: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
      );
    }
    return parsed.data;
  }

  private assertUniqueLeadIds(leads: readonly PipelineLead[]): void {
    const seen = new Set<string>();
    for (const lead of leads) {
      if (seen.has(lead.leadId)) {
        throw new TrackerSchemaError(`Duplicate lead ID ${lead.leadId}`);
      }
      seen.add(lead.leadId);
    }
  }

  private checkReplay(idempotencyKey: string, fingerprint: string): boolean {
    const existing = this.appliedKeys.get(idempotencyKey);
    if (existing === undefined) return false;
    if (existing !== fingerprint) {
      throw new TrackerWriteError(
        `Idempotency key ${idempotencyKey} was reused for a different effect`,
      );
    }
    return true;
  }

  private async findLeadRowIndex(leadId: string): Promise<number> {
    const leads = await this.listLeads();
    const index = leads.findIndex((lead) => lead.leadId === leadId);
    if (index < 0) {
      throw new TrackerWriteError(`Unknown lead ID ${leadId}`);
    }
    return index;
  }
}
