import { describe, expect, it } from "vitest";

import { A0NoOpAgent } from "../src/agents/a0.js";
import { PIPELINE_HEADERS } from "../src/models/tracker.js";
import type { RunLogEvent, StructuredLogger } from "../src/runtime/logger.js";
import {
  PermanentOperationError,
  TransientOperationError,
  classifyRetry,
} from "../src/runtime/retry.js";
import { executeAgentRun, type RunClock } from "../src/runtime/run.js";
import { TrackerWriteRouter } from "../src/runtime/write-router.js";
import { InMemoryTrackerRepository } from "../src/tracker/memory.js";
import { TrackerSchemaError } from "../src/tracker/repository.js";

const RUN_ID = "4ed2681a-53b6-4c07-825d-6261c3ecfa32";
const CORRELATION_ID = "af2cf374-3ae1-4f64-af2f-9f54df40f499";
const WRITE_KEY = "ad3fe62c-ea90-4f9f-832b-8c755268212d";

function pipelineRow(
  values: Readonly<Record<string, unknown>> = {},
): unknown[] {
  const defaults: Record<string, unknown> = {
    Company: "Example Labs",
    "Lead ID": "L-20261007-001",
    Source: "Funding news",
    Signal: "Funding round",
    Stage: "New",
    ...values,
  };
  return PIPELINE_HEADERS.map((header) => defaults[header] ?? "");
}

class SequenceClock implements RunClock {
  private index = 0;

  constructor(private readonly instants: readonly string[]) {}

  now(): Date {
    const instant = this.instants[this.index];
    if (instant === undefined) throw new Error("Clock sequence exhausted");
    this.index += 1;
    return new Date(instant);
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

function clock(): RunClock {
  return new SequenceClock([
    "2026-10-07T10:00:00.000Z",
    "2026-10-07T10:00:01.000Z",
  ]);
}

describe("A0 run lifecycle", () => {
  it("records exactly one successful terminal run without changing a lead", async () => {
    const tracker = new InMemoryTrackerRepository({ rows: [pipelineRow()] });
    const before = await tracker.listLeads();
    const logger = new CapturingLogger();

    const result = await executeAgentRun({
      agent: new A0NoOpAgent(),
      tracker,
      trigger: "manual_test",
      dryRun: true,
      logger,
      clock: clock(),
      identifiers: { runId: RUN_ID, correlationId: CORRELATION_ID },
    });

    expect(result.status).toBe("success");
    expect(await tracker.listRuns()).toEqual([result]);
    expect(await tracker.listLeads()).toEqual(before);
    expect(logger.infoEvents.map(({ event }) => event)).toEqual([
      "run_started",
      "run_finished",
    ]);
  });

  it("records exactly one skipped terminal run without changing a lead", async () => {
    const tracker = new InMemoryTrackerRepository({ rows: [pipelineRow()] });
    const before = await tracker.listLeads();
    const result = await executeAgentRun({
      agent: new A0NoOpAgent(() =>
        Promise.resolve({ ready: false, reason: "outside_window" }),
      ),
      tracker,
      trigger: "schedule",
      dryRun: true,
      logger: new CapturingLogger(),
      clock: clock(),
      identifiers: { runId: RUN_ID, correlationId: CORRELATION_ID },
    });

    expect(result).toMatchObject({
      status: "skipped",
      error: "outside_window",
    });
    expect(await tracker.listRuns()).toEqual([result]);
    expect(await tracker.listLeads()).toEqual(before);
  });

  it("records exactly one failed terminal run without changing a lead", async () => {
    const tracker = new InMemoryTrackerRepository({ rows: [pipelineRow()] });
    const before = await tracker.listLeads();
    const logger = new CapturingLogger();
    const result = await executeAgentRun({
      agent: new A0NoOpAgent(() => {
        throw new TransientOperationError("temporary dependency failure");
      }),
      tracker,
      trigger: "schedule",
      dryRun: true,
      logger,
      clock: clock(),
      identifiers: { runId: RUN_ID, correlationId: CORRELATION_ID },
    });

    expect(result).toMatchObject({
      status: "failed",
      error: "temporary dependency failure",
    });
    expect(await tracker.listRuns()).toEqual([result]);
    expect(await tracker.listLeads()).toEqual(before);
    expect(logger.errorEvents).toContainEqual(
      expect.objectContaining({
        event: "run_finished",
        status: "failed",
        retry: true,
        retryReason: "explicit_transient",
      }),
    );
  });
});

describe("dry-run write router", () => {
  it("records an idempotent intent without changing the live lead", async () => {
    const tracker = new InMemoryTrackerRepository({ rows: [pipelineRow()] });
    const router = new TrackerWriteRouter(tracker, true);
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

    expect(await router.routeLeadWrite(request)).toEqual({
      destination: "dry_run_output",
      outcome: "applied",
    });
    expect(await router.routeLeadWrite(request)).toEqual({
      destination: "dry_run_output",
      outcome: "replayed",
    });
    expect((await tracker.listLeads())[0]?.stage).toBe("New");
    expect(await tracker.listDryRunOutputs()).toHaveLength(1);
  });

  it("applies a live write without creating a dry-run record", async () => {
    const tracker = new InMemoryTrackerRepository({ rows: [pipelineRow()] });
    const router = new TrackerWriteRouter(tracker, false);
    expect(
      await router.routeLeadWrite({
        runId: RUN_ID,
        agent: "A1",
        createdAt: "2026-10-07T10:00:00.000Z",
        write: {
          idempotencyKey: WRITE_KEY,
          leadId: "L-20261007-001",
          changes: { Stage: "Researched" },
        },
      }),
    ).toEqual({ destination: "live_pipeline", outcome: "applied" });
    expect((await tracker.listLeads())[0]?.stage).toBe("Researched");
    expect(await tracker.listDryRunOutputs()).toEqual([]);
  });
});

describe("retry classification", () => {
  it("retries only explicit transient, network, timeout, and selected HTTP failures", () => {
    expect(classifyRetry(new TransientOperationError("later")).retry).toBe(
      true,
    );
    expect(classifyRetry({ code: "ETIMEDOUT" }).retry).toBe(true);
    expect(classifyRetry({ status: 429 }).retry).toBe(true);
    expect(classifyRetry({ statusCode: 503 }).retry).toBe(true);
  });

  it("treats validation, client, explicit permanent, and unknown failures as permanent", () => {
    expect(classifyRetry(new PermanentOperationError("stop")).retry).toBe(
      false,
    );
    expect(classifyRetry(new TrackerSchemaError("bad headers")).retry).toBe(
      false,
    );
    expect(classifyRetry({ status: 400 }).retry).toBe(false);
    expect(classifyRetry(new Error("programming failure")).retry).toBe(false);
  });
});
