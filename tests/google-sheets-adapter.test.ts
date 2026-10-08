import { describe, expect, it } from "vitest";

import { A0NoOpAgent } from "../src/agents/a0.js";
import {
  GoogleSheetsTrackerRepository,
  type GoogleSheetsTransport,
  type SheetValueUpdate,
} from "../src/integrations/google-sheets.js";
import { PIPELINE_HEADERS, type PipelineLead } from "../src/models/tracker.js";
import type { RunLogEvent, StructuredLogger } from "../src/runtime/logger.js";
import { executeAgentRun, type RunClock } from "../src/runtime/run.js";
import { TrackerWriteRouter } from "../src/runtime/write-router.js";

const RUN_ID = "684085d7-908d-4d79-a9b3-d3da6a9cbbbf";
const CORRELATION_ID = "377fcd88-7009-4cbf-9a26-a5f63d233f62";
const WRITE_KEY = "6ed78ad1-cf39-46b6-ac52-aae7523257c3";

function columnIndex(name: string): number {
  let value = 0;
  for (let index = 0; index < name.length; index += 1) {
    value = value * 26 + name.charCodeAt(index) - 64;
  }
  return value - 1;
}

function pipelineRow(
  headers: readonly string[],
  values: Readonly<Record<string, unknown>> = {},
): unknown[] {
  const defaults: Record<string, unknown> = {
    Company: "Synthetic Studio",
    "Lead ID": "L-20261007-001",
    Source: "Funding news",
    Signal: "Funding round",
    Stage: "New",
    ...values,
  };
  return headers.map((header) => defaults[header] ?? "");
}

class FakeSheetsTransport implements GoogleSheetsTransport {
  readonly runs: unknown[][] = [];
  readonly dryRunOutputs: unknown[][] = [];
  readonly sources: unknown[][] = [];
  readonly doNotContact: unknown[][] = [];
  failRunWrite = false;

  constructor(
    readonly headers: string[] = [...PIPELINE_HEADERS],
    readonly pipelineRows: unknown[][] = [pipelineRow(headers)],
  ) {}

  getValues(range: string): Promise<readonly (readonly unknown[])[]> {
    if (range === "'Pipeline'!2:2") return Promise.resolve([this.headers]);
    if (range.startsWith("'Pipeline'!A3:")) {
      return Promise.resolve(this.pipelineRows);
    }
    if (range === "'Runs'!A2:N1000") return Promise.resolve(this.runs);
    if (range === "'Dry Run Output'!A2:G1000") {
      return Promise.resolve(this.dryRunOutputs);
    }
    if (range === "'Sources'!A2:I1000") return Promise.resolve(this.sources);
    if (range === "'Do Not Contact'!A2:G1000") {
      return Promise.resolve(this.doNotContact);
    }
    const match = /^'Pipeline'!([A-Z]+)(\d+)$/.exec(range);
    if (match !== null) {
      const [, column = "A", row = "3"] = match;
      return Promise.resolve([
        [this.pipelineRows[Number(row) - 3]?.[columnIndex(column)] ?? ""],
      ]);
    }
    throw new Error(`Unexpected read range ${range}`);
  }

  batchUpdateValues(updates: readonly SheetValueUpdate[]): Promise<void> {
    for (const update of updates) {
      const runMatch = /^'Runs'!A(\d+):N\1$/.exec(update.range);
      if (runMatch !== null) {
        if (this.failRunWrite)
          return Promise.reject(new Error("Sheets offline"));
        const rowIndex = Number(runMatch[1]) - 2;
        this.runs[rowIndex] = [...(update.values[0] ?? [])];
        continue;
      }
      const dryRunMatch = /^'Dry Run Output'!A(\d+):G\1$/.exec(update.range);
      if (dryRunMatch !== null) {
        const rowIndex = Number(dryRunMatch[1]) - 2;
        this.dryRunOutputs[rowIndex] = [...(update.values[0] ?? [])];
        continue;
      }
      const match = /^'Pipeline'!([A-Z]+)(\d+)$/.exec(update.range);
      if (match === null) throw new Error(`Unexpected update ${update.range}`);
      const [, column = "A", row = "3"] = match;
      const targetRow = this.pipelineRows[Number(row) - 3];
      if (targetRow === undefined) throw new Error("Missing fake row");
      targetRow[columnIndex(column)] = update.values[0]?.[0] ?? "";
    }
    return Promise.resolve();
  }

  appendValues(): Promise<void> {
    return Promise.reject(new Error("Append should not be used"));
  }
}

class FixedClock implements RunClock {
  private call = 0;

  now(): Date {
    this.call += 1;
    return new Date(
      this.call % 2 === 1
        ? "2026-10-07T10:00:00.000Z"
        : "2026-10-07T10:00:01.000Z",
    );
  }
}

class CapturingLogger implements StructuredLogger {
  readonly infoEvents: RunLogEvent[] = [];
  readonly errorEvents: RunLogEvent[] = [];

  info(event: RunLogEvent): void {
    this.infoEvents.push(event);
  }

  error(event: RunLogEvent): void {
    this.errorEvents.push(event);
  }
}

describe("Google Sheets tracker adapter", () => {
  it("logs A0 once and treats a replayed run ID as the same effect", async () => {
    const transport = new FakeSheetsTransport();
    const tracker = new GoogleSheetsTrackerRepository(transport);
    const options = {
      agent: new A0NoOpAgent(),
      tracker,
      trigger: "integration_test",
      dryRun: true,
      logger: new CapturingLogger(),
      clock: new FixedClock(),
      identifiers: { runId: RUN_ID, correlationId: CORRELATION_ID },
    } as const;

    await executeAgentRun(options);
    await executeAgentRun(options);
    expect(await tracker.listRuns()).toHaveLength(1);
  });

  it("isolates and deduplicates dry-run output", async () => {
    const transport = new FakeSheetsTransport();
    const tracker = new GoogleSheetsTrackerRepository(transport);
    const router = new TrackerWriteRouter(tracker, true);
    const before = await tracker.listLeads();
    const request = {
      runId: RUN_ID,
      agent: "A0" as const,
      createdAt: "2026-10-07T10:00:00.000Z",
      write: {
        idempotencyKey: WRITE_KEY,
        leadId: "L-20261007-001",
        changes: { Stage: "Researched" },
      },
    };

    expect((await router.routeLeadWrite(request)).outcome).toBe("applied");
    expect((await router.routeLeadWrite(request)).outcome).toBe("replayed");
    expect(await tracker.listLeads()).toEqual(before);
    expect(await tracker.listDryRunOutputs()).toHaveLength(1);
  });

  it("writes before preformatted blank rows instead of appending after them", async () => {
    const transport = new FakeSheetsTransport();
    transport.runs.push(new Array(11).fill(""), [
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      0,
      0,
      "",
      false,
    ]);
    const tracker = new GoogleSheetsTrackerRepository(transport);

    await executeAgentRun({
      agent: new A0NoOpAgent(),
      tracker,
      trigger: "integration_test",
      dryRun: true,
      logger: new CapturingLogger(),
      clock: new FixedClock(),
      identifiers: { runId: RUN_ID, correlationId: CORRELATION_ID },
    });

    expect(transport.runs[0]?.[0]).toBe(RUN_ID);
    expect(await tracker.listRuns()).toHaveLength(1);
  });

  it("addresses reordered columns by exact header name", async () => {
    const headers = [...PIPELINE_HEADERS].reverse();
    const transport = new FakeSheetsTransport(headers, [pipelineRow(headers)]);
    const tracker = new GoogleSheetsTrackerRepository(transport);
    const router = new TrackerWriteRouter(tracker, false);
    await router.routeLeadWrite({
      runId: RUN_ID,
      agent: "A1",
      createdAt: "2026-10-07T10:00:00.000Z",
      write: {
        idempotencyKey: WRITE_KEY,
        leadId: "L-20261007-001",
        changes: { Stage: "Researched" },
      },
    });
    expect((await tracker.listLeads())[0]?.stage).toBe("Researched");
  });

  it("writes and verifies a lock before continuing", async () => {
    const transport = new FakeSheetsTransport();
    const tracker = new GoogleSheetsTrackerRepository(transport);
    const token = "b8d0a207-77fd-432b-ab9a-a83052a14e83";
    expect(
      await tracker.acquireLeadLock({
        leadId: "L-20261007-001",
        token,
        acquiredAt: "2026-10-07T10:00:00.000Z",
      }),
    ).toEqual({ outcome: "acquired" });
    expect(
      await tracker.releaseLeadLock(
        "L-20261007-001",
        token,
        "2026-10-07T10:01:00.000Z",
      ),
    ).toBe(true);
  });

  it("keeps a simulated Sheets failure visible in structured logs", async () => {
    const transport = new FakeSheetsTransport();
    transport.failRunWrite = true;
    const logger = new CapturingLogger();
    await expect(
      executeAgentRun({
        agent: new A0NoOpAgent(),
        tracker: new GoogleSheetsTrackerRepository(transport),
        trigger: "integration_test",
        dryRun: true,
        logger,
        clock: new FixedClock(),
        identifiers: { runId: RUN_ID, correlationId: CORRELATION_ID },
      }),
    ).rejects.toThrow("Sheets offline");
    expect(logger.errorEvents).toContainEqual(
      expect.objectContaining({ event: "run_record_failed" }),
    );
  });

  it("returns fully parsed leads from bounded reads", async () => {
    const transport = new FakeSheetsTransport(
      [...PIPELINE_HEADERS],
      [
        pipelineRow(PIPELINE_HEADERS, {
          "Signal date": 46302,
          "Last agent run": 46302.375,
        }),
      ],
    );
    const tracker = new GoogleSheetsTrackerRepository(transport);
    const leads: readonly PipelineLead[] = await tracker.listLeads();
    expect(leads[0]).toMatchObject({
      leadId: "L-20261007-001",
      company: "Synthetic Studio",
      signalDate: "2026-10-07",
      lastAgentRun: "2026-10-07T09:00:00.000+05:30",
    });
  });

  it("ignores preformatted blank Pipeline rows without Lead IDs", async () => {
    const blank = pipelineRow(PIPELINE_HEADERS, {
      Company: "",
      "Lead ID": "",
      Source: "",
      Signal: "",
      Stage: "",
      Approved: false,
    });
    const transport = new FakeSheetsTransport(
      [...PIPELINE_HEADERS],
      [pipelineRow(PIPELINE_HEADERS), blank],
    );
    const tracker = new GoogleSheetsTrackerRepository(transport);

    expect(await tracker.listLeads()).toHaveLength(1);
  });

  it("parses configured sources and DNC entries from bounded reads", async () => {
    const transport = new FakeSheetsTransport();
    transport.sources.push([
      "S-001",
      "Funding search",
      "search_query",
      '"funding round"',
      "funded startups",
      true,
      46302.375,
      "cursor-1",
      "",
    ]);
    transport.doNotContact.push([
      "blocked.example",
      "blocked.example",
      "domain",
      46302,
      "manual",
      "",
      "owner",
    ]);
    const tracker = new GoogleSheetsTrackerRepository(transport);

    expect(await tracker.listSources()).toEqual([
      expect.objectContaining({
        sourceId: "S-001",
        active: true,
        lastSuccessfulFetch: "2026-10-07T09:00:00.000+05:30",
      }),
    ]);
    expect(await tracker.listDoNotContact()).toEqual([
      expect.objectContaining({
        normalizedValue: "blocked.example",
        added: "2026-10-07",
      }),
    ]);
  });
});
