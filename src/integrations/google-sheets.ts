import { z } from "zod";

import { isoDateSchema } from "../models/common.js";
import {
  doNotContactRowSchema,
  dryRunOutputRowSchema,
  runRowSchema,
  sourceRowSchema,
  type DoNotContactRow,
  type DryRunOutputRow,
  type PipelineLead,
  type RunRow,
  type SourceRow,
} from "../models/tracker.js";
import { InMemoryTrackerRepository } from "../tracker/memory.js";
import {
  HUMAN_ONLY_PIPELINE_HEADERS,
  IMMUTABLE_PIPELINE_HEADERS,
  TrackerSchemaError,
  TrackerWriteError,
  type AcquireLockRequest,
  type AcquireLockResult,
  type HeaderDiscovery,
  type IdempotentWriteResult,
  type PipelineHeader,
  type ProposedLeadWrite,
  type TrackerRepository,
} from "../tracker/repository.js";

const idempotencyKeySchema = z.string().uuid();
const lockTokenSchema = z.string().uuid();
const DEFAULT_STALE_LOCK_MS = 30 * 60 * 1000;
const SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 24 * 60 * 60 * 1000;
const KOLKATA_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DATE_HEADERS = new Set<PipelineHeader>([
  "Signal date",
  "Last touch",
  "Next date",
]);
const DATETIME_HEADERS = new Set<PipelineHeader>([
  "Last agent run",
  "Stage changed at",
]);

export interface SheetValueUpdate {
  range: string;
  values: readonly (readonly unknown[])[];
}

export interface GoogleSheetsTransport {
  getValues(range: string): Promise<readonly (readonly unknown[])[]>;
  batchUpdateValues(updates: readonly SheetValueUpdate[]): Promise<void>;
  appendValues(
    range: string,
    values: readonly (readonly unknown[])[],
  ): Promise<void>;
}

export interface GoogleSheetsWorkbookTransport extends GoogleSheetsTransport {
  getSpreadsheet<T = unknown>(fields: string): Promise<T>;
  batchUpdateSpreadsheet<T = unknown>(
    requests: readonly unknown[],
    options?: {
      includeSpreadsheetInResponse?: boolean;
      responseRanges?: readonly string[];
    },
  ): Promise<T>;
}

export interface AccessTokenProvider {
  getAccessToken(): Promise<string>;
}

export interface GoogleSheetsRestTransportOptions {
  spreadsheetId: string;
  tokenProvider: AccessTokenProvider;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface ValuesResponse {
  values?: unknown[][];
}

export class GoogleSheetsHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GoogleSheetsHttpError";
    this.status = status;
  }
}

export class GoogleSheetsRestTransport implements GoogleSheetsTransport {
  private readonly spreadsheetId: string;
  private readonly tokenProvider: AccessTokenProvider;
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: GoogleSheetsRestTransportOptions) {
    this.spreadsheetId = options.spreadsheetId;
    this.tokenProvider = options.tokenProvider;
    this.fetchImplementation = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async getValues(range: string): Promise<readonly (readonly unknown[])[]> {
    const response = await this.request<ValuesResponse>(
      `/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`,
      { method: "GET" },
    );
    return response.values ?? [];
  }

  async batchUpdateValues(updates: readonly SheetValueUpdate[]): Promise<void> {
    await this.request("/values:batchUpdate", {
      method: "POST",
      body: JSON.stringify({
        valueInputOption: "RAW",
        data: updates.map((update) => ({
          range: update.range,
          majorDimension: "ROWS",
          values: update.values,
        })),
      }),
    });
  }

  async appendValues(
    range: string,
    values: readonly (readonly unknown[])[],
  ): Promise<void> {
    await this.request(
      `/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        body: JSON.stringify({ majorDimension: "ROWS", values }),
      },
    );
  }

  async getSpreadsheet<T = unknown>(fields: string): Promise<T> {
    return this.request<T>(`?fields=${encodeURIComponent(fields)}`, {
      method: "GET",
    });
  }

  async batchUpdateSpreadsheet<T = unknown>(
    requests: readonly unknown[],
    options: {
      includeSpreadsheetInResponse?: boolean;
      responseRanges?: readonly string[];
    } = {},
  ): Promise<T> {
    return this.request<T>(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({
        requests,
        includeSpreadsheetInResponse:
          options.includeSpreadsheetInResponse ?? false,
        responseIncludeGridData: false,
        responseRanges: options.responseRanges ?? [],
      }),
    });
  }

  private async request<T = unknown>(
    path: string,
    init: RequestInit,
  ): Promise<T> {
    const token = await this.tokenProvider.getAccessToken();
    const response = await this.fetchImplementation(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId)}${path}`,
      {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );
    if (!response.ok) {
      throw new GoogleSheetsHttpError(
        response.status,
        `Google Sheets request failed with HTTP ${String(response.status)}`,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

function validateIdempotencyKey(value: string): void {
  if (!idempotencyKeySchema.safeParse(value).success) {
    throw new TrackerWriteError("idempotencyKey must be a UUID");
  }
}

function columnName(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function serializeCell(value: unknown): unknown {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.join("\n");
  if (["string", "number", "boolean"].includes(typeof value)) return value;
  return JSON.stringify(value);
}

function isoDateToSerial(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return (
    (Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1) - SHEETS_EPOCH_MS) / DAY_MS
  );
}

function isoDateTimeToSerial(value: string): number {
  return (Date.parse(value) + KOLKATA_OFFSET_MS - SHEETS_EPOCH_MS) / DAY_MS;
}

function serialToIsoDate(value: number): string {
  return new Date(SHEETS_EPOCH_MS + value * DAY_MS).toISOString().slice(0, 10);
}

function serialToIsoDateTime(value: number): string {
  const local = new Date(SHEETS_EPOCH_MS + value * DAY_MS).toISOString();
  return `${local.slice(0, 23)}+05:30`;
}

function dateTimeValue(value: unknown): unknown {
  return typeof value === "number" ? serialToIsoDateTime(value) : value;
}

function serializePipelineCell(
  header: PipelineHeader,
  value: unknown,
): unknown {
  if (typeof value === "string" && DATE_HEADERS.has(header)) {
    return isoDateToSerial(value);
  }
  if (typeof value === "string" && DATETIME_HEADERS.has(header)) {
    return isoDateTimeToSerial(value);
  }
  return serializeCell(value);
}

function normalizePipelineRows(
  rows: readonly (readonly unknown[])[],
  discovery: HeaderDiscovery,
): unknown[][] {
  return rows.map((row) => {
    const normalized = [...row];
    for (const header of DATE_HEADERS) {
      const index = discovery.indexes.get(header);
      if (index !== undefined && typeof normalized[index] === "number") {
        normalized[index] = serialToIsoDate(normalized[index]);
      }
    }
    for (const header of DATETIME_HEADERS) {
      const index = discovery.indexes.get(header);
      if (index !== undefined && typeof normalized[index] === "number") {
        normalized[index] = serialToIsoDateTime(normalized[index]);
      }
    }
    return normalized;
  });
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function booleanValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return String(value).toLowerCase() === "true";
}

function cellText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function nextWritableRow(
  rows: readonly (readonly unknown[])[],
  firstRow: number,
  finalRow: number,
  sheetName: string,
): number {
  const emptyIndex = rows.findIndex((row) => cellText(row[0]) === "");
  const rowNumber = firstRow + (emptyIndex === -1 ? rows.length : emptyIndex);
  if (rowNumber > finalRow) {
    throw new TrackerWriteError(`${sheetName} has no writable rows remaining`);
  }
  return rowNumber;
}

function parseLock(
  value: unknown,
): { token: string; acquiredAt: string } | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new TrackerWriteError("Existing Agent lock is malformed");
  }
  try {
    const candidate = JSON.parse(value) as unknown;
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      "token" in candidate &&
      "acquiredAt" in candidate &&
      typeof candidate.token === "string" &&
      typeof candidate.acquiredAt === "string"
    ) {
      return { token: candidate.token, acquiredAt: candidate.acquiredAt };
    }
  } catch (error) {
    throw new TrackerWriteError("Existing Agent lock is malformed", {
      cause: error,
    });
  }
  throw new TrackerWriteError("Existing Agent lock is malformed");
}

function parseRun(row: readonly unknown[]): RunRow {
  return runRowSchema.parse({
    runId: row[0],
    agent: row[1],
    started: dateTimeValue(row[2]),
    finished: dateTimeValue(row[3]),
    status: row[4],
    leadsProcessed: numberValue(row[5]),
    leadIds:
      typeof row[6] === "string" && row[6].length > 0 ? row[6].split("\n") : [],
    llmModel: textOrNull(row[7]),
    inputTokens: numberValue(row[8]),
    outputTokens: numberValue(row[9]),
    error: textOrNull(row[10]),
    dryRun: booleanValue(row[11]),
    trigger: row[12],
    correlationId: row[13],
  });
}

function parseSource(row: readonly unknown[]): SourceRow {
  return sourceRowSchema.parse({
    sourceId: row[0],
    sourceName: row[1],
    type: row[2],
    queryOrUrl: row[3],
    segment: row[4],
    active: booleanValue(row[5]),
    lastSuccessfulFetch:
      row[6] === "" || row[6] === null || row[6] === undefined
        ? null
        : dateTimeValue(row[6]),
    cursorOrCheckpoint: textOrNull(row[7]),
    error: textOrNull(row[8]),
  });
}

function parseDoNotContact(row: readonly unknown[]): DoNotContactRow {
  return doNotContactRowSchema.parse({
    emailOrDomain: row[0],
    normalizedValue: row[1],
    kind: row[2],
    added: typeof row[3] === "number" ? serialToIsoDate(row[3]) : row[3],
    reason: row[4],
    sourceLeadId: textOrNull(row[5]),
    addedBy: row[6],
  });
}

function runValues(run: RunRow): readonly unknown[] {
  return [
    run.runId,
    run.agent,
    isoDateTimeToSerial(run.started),
    isoDateTimeToSerial(run.finished),
    run.status,
    run.leadsProcessed,
    run.leadIds.join("\n"),
    run.llmModel ?? "",
    run.inputTokens,
    run.outputTokens,
    run.error ?? "",
    run.dryRun,
    run.trigger,
    run.correlationId,
  ];
}

export class GoogleSheetsTrackerRepository implements TrackerRepository {
  private readonly allocatedLeadIds = new Map<string, string>();

  constructor(private readonly transport: GoogleSheetsTransport) {}

  async discoverPipelineHeaders(): Promise<HeaderDiscovery> {
    const rows = await this.transport.getValues("'Pipeline'!2:2");
    const headers = (rows[0] ?? []).map(String);
    const validator = new InMemoryTrackerRepository({ headers });
    return validator.discoverPipelineHeaders();
  }

  async listLeads(): Promise<readonly PipelineLead[]> {
    const discovery = await this.discoverPipelineHeaders();
    const finalColumn = columnName(discovery.headers.length - 1);
    const rows = await this.transport.getValues(
      `'Pipeline'!A3:${finalColumn}1000`,
    );
    const leadIdColumn = discovery.indexes.get("Lead ID");
    if (leadIdColumn === undefined) {
      throw new TrackerSchemaError("Missing Pipeline header Lead ID");
    }
    const nonEmptyRows = rows.filter(
      (row) => cellText(row[leadIdColumn]).trim() !== "",
    );
    return new InMemoryTrackerRepository({
      headers: discovery.headers,
      rows: normalizePipelineRows(nonEmptyRows, discovery),
    }).listLeads();
  }

  async listSources(): Promise<readonly SourceRow[]> {
    const rows = await this.transport.getValues("'Sources'!A2:I1000");
    return rows.filter((row) => cellText(row[0]) !== "").map(parseSource);
  }

  async listDoNotContact(): Promise<readonly DoNotContactRow[]> {
    const rows = await this.transport.getValues("'Do Not Contact'!A2:G1000");
    return rows.filter((row) => cellText(row[0]) !== "").map(parseDoNotContact);
  }

  async proposeLeadWrite(
    write: ProposedLeadWrite,
  ): Promise<IdempotentWriteResult> {
    validateIdempotencyKey(write.idempotencyKey);
    const protectedHeaders = new Set<PipelineHeader>([
      ...HUMAN_ONLY_PIPELINE_HEADERS,
      ...IMMUTABLE_PIPELINE_HEADERS,
    ]);
    for (const header of Object.keys(write.changes) as PipelineHeader[]) {
      if (protectedHeaders.has(header)) {
        throw new TrackerWriteError(`Service write to ${header} is forbidden`);
      }
    }

    const discovery = await this.discoverPipelineHeaders();
    const finalColumn = columnName(discovery.headers.length - 1);
    const rows = await this.transport.getValues(
      `'Pipeline'!A3:${finalColumn}1000`,
    );
    const leadIdColumn = discovery.indexes.get("Lead ID");
    if (leadIdColumn === undefined) {
      throw new TrackerSchemaError("Missing Pipeline header Lead ID");
    }
    const rowIndex = rows.findIndex(
      (row) => row[leadIdColumn] === write.leadId,
    );
    if (rowIndex < 0) {
      throw new TrackerWriteError(`Unknown lead ID ${write.leadId}`);
    }

    const candidate =
      normalizePipelineRows([rows[rowIndex] ?? []], discovery)[0] ?? [];
    let changed = false;
    const updates: SheetValueUpdate[] = [];
    for (const [header, value] of Object.entries(write.changes) as [
      PipelineHeader,
      unknown,
    ][]) {
      const columnIndex = discovery.indexes.get(header);
      if (columnIndex === undefined) {
        throw new TrackerSchemaError(`Missing Pipeline header ${header}`);
      }
      const serialized = serializePipelineCell(header, value);
      candidate[columnIndex] = value;
      if (
        JSON.stringify(rows[rowIndex]?.[columnIndex] ?? "") !==
        JSON.stringify(serialized)
      ) {
        changed = true;
        updates.push({
          range: `'Pipeline'!${columnName(columnIndex)}${String(rowIndex + 3)}`,
          values: [[serialized]],
        });
      }
    }
    await new InMemoryTrackerRepository({
      headers: discovery.headers,
      rows: [candidate],
    }).listLeads();
    if (!changed) return { outcome: "replayed" };

    await this.discoverPipelineHeaders();
    await this.transport.batchUpdateValues(updates);
    return { outcome: "applied" };
  }

  async appendRun(
    run: RunRow,
    idempotencyKey: string,
  ): Promise<IdempotentWriteResult> {
    validateIdempotencyKey(idempotencyKey);
    const parsed = runRowSchema.parse(run);
    const rows = await this.transport.getValues("'Runs'!A2:N1000");
    if (rows.some((row) => row[0] === parsed.runId)) {
      return { outcome: "replayed" };
    }
    const rowNumber = nextWritableRow(rows, 2, 1000, "Runs");
    await this.transport.batchUpdateValues([
      {
        range: `'Runs'!A${String(rowNumber)}:N${String(rowNumber)}`,
        values: [runValues(parsed)],
      },
    ]);
    return { outcome: "applied" };
  }

  async listRuns(): Promise<readonly RunRow[]> {
    const rows = await this.transport.getValues("'Runs'!A2:N1000");
    return rows.filter((row) => cellText(row[0]) !== "").map(parseRun);
  }

  async appendDryRunOutput(
    output: DryRunOutputRow,
    idempotencyKey: string,
  ): Promise<IdempotentWriteResult> {
    validateIdempotencyKey(idempotencyKey);
    const parsed = dryRunOutputRowSchema.parse(output);
    const signature = [
      parsed.runId,
      parsed.agent,
      parsed.leadId ?? "",
      parsed.proposedOperation,
      parsed.target,
    ].map(String);
    const rows = await this.transport.getValues("'Dry Run Output'!A2:G1000");
    if (
      rows.some((row) =>
        signature.every((value, index) => cellText(row[index]) === value),
      )
    ) {
      return { outcome: "replayed" };
    }
    const rowNumber = nextWritableRow(rows, 2, 1000, "Dry Run Output");
    await this.transport.batchUpdateValues([
      {
        range: `'Dry Run Output'!A${String(rowNumber)}:G${String(rowNumber)}`,
        values: [
          [
            parsed.runId,
            parsed.agent,
            parsed.leadId ?? "",
            parsed.proposedOperation,
            parsed.target,
            JSON.stringify(parsed.proposedValue),
            isoDateTimeToSerial(parsed.createdAt),
          ],
        ],
      },
    ]);
    return { outcome: "applied" };
  }

  async listDryRunOutputs(): Promise<readonly DryRunOutputRow[]> {
    const rows = await this.transport.getValues("'Dry Run Output'!A2:G1000");
    return rows
      .filter((row) => cellText(row[0]) !== "")
      .map((row) =>
        dryRunOutputRowSchema.parse({
          runId: row[0],
          agent: row[1],
          leadId: textOrNull(row[2]),
          proposedOperation: row[3],
          target: row[4],
          proposedValue:
            typeof row[5] === "string"
              ? (JSON.parse(row[5]) as unknown)
              : row[5],
          createdAt: dateTimeValue(row[6]),
        }),
      );
  }

  async acquireLeadLock(
    request: AcquireLockRequest,
  ): Promise<AcquireLockResult> {
    if (!lockTokenSchema.safeParse(request.token).success) {
      throw new TrackerWriteError("lock token must be a UUID");
    }
    const now = Date.parse(request.acquiredAt);
    if (Number.isNaN(now)) {
      throw new TrackerWriteError("acquiredAt must be a valid datetime");
    }
    const staleAfterMs = request.staleAfterMs ?? DEFAULT_STALE_LOCK_MS;
    const location = await this.findLeadCell(request.leadId, "Agent lock");
    const currentRows = await this.transport.getValues(location.range);
    const existing = parseLock(currentRows[0]?.[0]);
    if (existing !== null) {
      const existingAt = Date.parse(existing.acquiredAt);
      if (Number.isNaN(existingAt)) {
        throw new TrackerWriteError("Existing Agent lock is malformed");
      }
      if (now - existingAt <= staleAfterMs) {
        return { outcome: "already_locked" };
      }
    }
    const encoded = JSON.stringify({
      token: request.token,
      acquiredAt: request.acquiredAt,
    });
    await this.transport.batchUpdateValues([
      { range: location.range, values: [[encoded]] },
    ]);
    const verification = await this.transport.getValues(location.range);
    if (parseLock(verification[0]?.[0])?.token !== request.token) {
      throw new TrackerWriteError("Lock verification failed");
    }
    return existing === null
      ? { outcome: "acquired" }
      : { outcome: "taken_over", previousToken: existing.token };
  }

  async releaseLeadLock(
    leadId: string,
    token: string,
    releasedAt: string,
  ): Promise<boolean> {
    if (Number.isNaN(Date.parse(releasedAt))) {
      throw new TrackerWriteError("releasedAt must be a valid datetime");
    }
    const location = await this.findLeadCell(leadId, "Agent lock");
    const rows = await this.transport.getValues(location.range);
    if (parseLock(rows[0]?.[0])?.token !== token) return false;
    await this.transport.batchUpdateValues([
      { range: location.range, values: [[""]] },
    ]);
    return true;
  }

  async allocateLeadId(date: string, idempotencyKey: string): Promise<string> {
    validateIdempotencyKey(idempotencyKey);
    const replay = this.allocatedLeadIds.get(idempotencyKey);
    if (replay !== undefined) return replay;
    if (!isoDateSchema.safeParse(date).success) {
      throw new TrackerWriteError("date must be a real ISO date");
    }
    const compact = date.replaceAll("-", "");
    const [leads, dryRunOutputs] = await Promise.all([
      this.listLeads(),
      this.listDryRunOutputs(),
    ]);
    const existing = new Set([
      ...leads.map((lead) => lead.leadId),
      ...dryRunOutputs.flatMap((output) =>
        output.leadId === null ? [] : [output.leadId],
      ),
    ]);
    for (const reserved of this.allocatedLeadIds.values())
      existing.add(reserved);
    const next =
      Math.max(
        0,
        ...[...existing]
          .filter((leadId) => leadId.startsWith(`L-${compact}-`))
          .map((leadId) => Number(leadId.slice(-3))),
      ) + 1;
    if (next > 999) {
      throw new TrackerWriteError(`Lead ID sequence exhausted for ${date}`);
    }
    const leadId = `L-${compact}-${String(next).padStart(3, "0")}`;
    this.allocatedLeadIds.set(idempotencyKey, leadId);
    return leadId;
  }

  private async findLeadCell(
    leadId: string,
    header: PipelineHeader,
  ): Promise<{ range: string }> {
    const discovery = await this.discoverPipelineHeaders();
    const leadIdColumn = discovery.indexes.get("Lead ID");
    const targetColumn = discovery.indexes.get(header);
    if (leadIdColumn === undefined || targetColumn === undefined) {
      throw new TrackerSchemaError(`Missing Pipeline header ${header}`);
    }
    const finalColumn = columnName(discovery.headers.length - 1);
    const rows = await this.transport.getValues(
      `'Pipeline'!A3:${finalColumn}1000`,
    );
    const rowIndex = rows.findIndex((row) => row[leadIdColumn] === leadId);
    if (rowIndex < 0) throw new TrackerWriteError(`Unknown lead ID ${leadId}`);
    return {
      range: `'Pipeline'!${columnName(targetColumn)}${String(rowIndex + 3)}`,
    };
  }
}
