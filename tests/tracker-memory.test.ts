import { describe, expect, it } from "vitest";

import { PIPELINE_HEADERS, type RunRow } from "../src/models/tracker.js";
import { InMemoryTrackerRepository } from "../src/tracker/memory.js";
import {
  TrackerSchemaError,
  TrackerWriteError,
} from "../src/tracker/repository.js";

const WRITE_KEY = "15b7184c-8a0d-4cc5-95d7-a644a8dc3fbd";
const SECOND_KEY = "f904491e-ae54-4f6b-b8c7-c4384637430a";
const LOCK_ONE = "5638af61-cd87-4eed-9944-ad79c38df7ab";
const LOCK_TWO = "33f40ee3-244a-4a2e-bf7b-ad2cd1e84a4a";

function pipelineRow(
  headers: readonly string[] = PIPELINE_HEADERS,
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
  return headers.map((header) => defaults[header] ?? "");
}

function runRow(overrides: Partial<RunRow> = {}): RunRow {
  return {
    runId: "55dd44f3-040d-4375-a405-7354d997162f",
    agent: "A0",
    started: "2026-10-07T10:00:00.000Z",
    finished: "2026-10-07T10:00:01.000Z",
    status: "success",
    leadsProcessed: 0,
    leadIds: [],
    llmModel: null,
    inputTokens: 0,
    outputTokens: 0,
    error: null,
    dryRun: true,
    trigger: "test",
    correlationId: "01248b8c-7d02-420a-834d-f576376c7dbe",
    ...overrides,
  };
}

describe("in-memory tracker headers and rows", () => {
  it("parses and updates rows safely when columns are reordered", async () => {
    const headers = [...PIPELINE_HEADERS].reverse();
    const repository = new InMemoryTrackerRepository({
      headers,
      rows: [pipelineRow(headers)],
    });

    expect((await repository.listLeads())[0]?.company).toBe("Example Labs");
    await expect(
      repository.proposeLeadWrite({
        idempotencyKey: WRITE_KEY,
        leadId: "L-20261007-001",
        changes: { Stage: "Researched", Touches: 1 },
      }),
    ).resolves.toEqual({ outcome: "applied" });

    expect((await repository.listLeads())[0]).toMatchObject({
      stage: "Researched",
      touches: 1,
    });
  });

  it("blocks writes when a required header is missing", async () => {
    const headers = PIPELINE_HEADERS.filter((header) => header !== "Stage");
    const repository = new InMemoryTrackerRepository({
      headers,
      rows: [pipelineRow(headers)],
    });

    await expect(
      repository.proposeLeadWrite({
        idempotencyKey: WRITE_KEY,
        leadId: "L-20261007-001",
        changes: { Touches: 1 },
      }),
    ).rejects.toThrow(/missing: Stage/);
  });

  it("blocks writes when any header is duplicated", async () => {
    const headers = [...PIPELINE_HEADERS, "Stage"];
    const repository = new InMemoryTrackerRepository({
      headers,
      rows: [pipelineRow(headers)],
    });

    await expect(
      repository.proposeLeadWrite({
        idempotencyKey: WRITE_KEY,
        leadId: "L-20261007-001",
        changes: { Touches: 1 },
      }),
    ).rejects.toThrow(/duplicate: Stage/);
  });

  it.each(["Notes", "Approved", "Email / LinkedIn"] as const)(
    "protects the human-owned %s column",
    async (header) => {
      const repository = new InMemoryTrackerRepository({
        rows: [pipelineRow()],
      });
      await expect(
        repository.proposeLeadWrite({
          idempotencyKey: WRITE_KEY,
          leadId: "L-20261007-001",
          changes: { [header]: "forbidden" },
        }),
      ).rejects.toThrow(`human-only column ${header}`);
    },
  );

  it("rejects duplicate lead IDs before a write", async () => {
    const repository = new InMemoryTrackerRepository({
      rows: [pipelineRow(), pipelineRow()],
    });
    await expect(
      repository.proposeLeadWrite({
        idempotencyKey: WRITE_KEY,
        leadId: "L-20261007-001",
        changes: { Touches: 1 },
      }),
    ).rejects.toThrow("Duplicate lead ID L-20261007-001");
  });

  it("reports row-level schema errors", async () => {
    const repository = new InMemoryTrackerRepository({
      rows: [pipelineRow(PIPELINE_HEADERS, { Stage: "Invented" })],
    });
    await expect(repository.listLeads()).rejects.toThrow(
      "Invalid Pipeline row 3",
    );
  });
});

describe("in-memory tracker idempotency", () => {
  it("does not repeat a proposed write for the same key", async () => {
    const repository = new InMemoryTrackerRepository({ rows: [pipelineRow()] });
    const write = {
      idempotencyKey: WRITE_KEY,
      leadId: "L-20261007-001",
      changes: { Touches: 1 },
    } as const;

    expect(await repository.proposeLeadWrite(write)).toEqual({
      outcome: "applied",
    });
    expect(await repository.proposeLeadWrite(write)).toEqual({
      outcome: "replayed",
    });
    expect((await repository.listLeads())[0]?.touches).toBe(1);
  });

  it("fails closed when a key is reused for another effect", async () => {
    const repository = new InMemoryTrackerRepository({ rows: [pipelineRow()] });
    await repository.proposeLeadWrite({
      idempotencyKey: WRITE_KEY,
      leadId: "L-20261007-001",
      changes: { Touches: 1 },
    });
    await expect(
      repository.proposeLeadWrite({
        idempotencyKey: WRITE_KEY,
        leadId: "L-20261007-001",
        changes: { Touches: 2 },
      }),
    ).rejects.toBeInstanceOf(TrackerWriteError);
  });

  it("appends a run exactly once under replay", async () => {
    const repository = new InMemoryTrackerRepository();
    expect(await repository.appendRun(runRow(), WRITE_KEY)).toEqual({
      outcome: "applied",
    });
    expect(await repository.appendRun(runRow(), WRITE_KEY)).toEqual({
      outcome: "replayed",
    });
    expect(await repository.listRuns()).toHaveLength(1);
  });

  it("rejects duplicate run IDs even under different keys", async () => {
    const repository = new InMemoryTrackerRepository();
    await repository.appendRun(runRow(), WRITE_KEY);
    await expect(repository.appendRun(runRow(), SECOND_KEY)).rejects.toThrow(
      "Duplicate run ID",
    );
  });
});

describe("in-memory tracker locks and IDs", () => {
  it("blocks an active lock and records a stale-lock takeover", async () => {
    const repository = new InMemoryTrackerRepository({ rows: [pipelineRow()] });
    await expect(
      repository.acquireLeadLock({
        leadId: "L-20261007-001",
        token: LOCK_ONE,
        acquiredAt: "2026-10-07T10:00:00.000Z",
      }),
    ).resolves.toEqual({ outcome: "acquired" });
    await expect(
      repository.acquireLeadLock({
        leadId: "L-20261007-001",
        token: LOCK_TWO,
        acquiredAt: "2026-10-07T10:30:00.000Z",
      }),
    ).resolves.toEqual({ outcome: "already_locked" });
    await expect(
      repository.acquireLeadLock({
        leadId: "L-20261007-001",
        token: LOCK_TWO,
        acquiredAt: "2026-10-07T10:30:00.001Z",
      }),
    ).resolves.toEqual({
      outcome: "taken_over",
      previousToken: LOCK_ONE,
    });
    expect(repository.lockEvents.at(-1)?.type).toBe("taken_over");
  });

  it("only releases a lock held by the matching token", async () => {
    const repository = new InMemoryTrackerRepository({ rows: [pipelineRow()] });
    await repository.acquireLeadLock({
      leadId: "L-20261007-001",
      token: LOCK_ONE,
      acquiredAt: "2026-10-07T10:00:00.000Z",
    });
    expect(
      await repository.releaseLeadLock(
        "L-20261007-001",
        LOCK_TWO,
        "2026-10-07T10:01:00.000Z",
      ),
    ).toBe(false);
    expect(
      await repository.releaseLeadLock(
        "L-20261007-001",
        LOCK_ONE,
        "2026-10-07T10:01:00.000Z",
      ),
    ).toBe(true);
  });

  it("fails closed when an existing lock cannot be parsed", async () => {
    const repository = new InMemoryTrackerRepository({
      rows: [pipelineRow(PIPELINE_HEADERS, { "Agent lock": "corrupt" })],
    });
    await expect(
      repository.acquireLeadLock({
        leadId: "L-20261007-001",
        token: LOCK_ONE,
        acquiredAt: "2026-10-07T10:00:00.000Z",
      }),
    ).rejects.toThrow("Existing Agent lock is malformed");
  });

  it("allocates deterministic daily lead IDs without replay gaps", async () => {
    const repository = new InMemoryTrackerRepository({
      rows: [pipelineRow(PIPELINE_HEADERS, { "Lead ID": "L-20261007-004" })],
    });
    expect(await repository.allocateLeadId("2026-10-07", WRITE_KEY)).toBe(
      "L-20261007-005",
    );
    expect(await repository.allocateLeadId("2026-10-07", WRITE_KEY)).toBe(
      "L-20261007-005",
    );
    expect(await repository.allocateLeadId("2026-10-07", SECOND_KEY)).toBe(
      "L-20261007-006",
    );
  });

  it("reserves lead IDs already proposed in dry-run output", async () => {
    const repository = new InMemoryTrackerRepository({
      dryRunOutputs: [
        {
          runId: "684085d7-908d-4d79-a9b3-d3da6a9cbbbf",
          agent: "A1",
          leadId: "L-20261007-005",
          proposedOperation: "create_pipeline_lead",
          target: "Pipeline:story-1",
          proposedValue: {},
          createdAt: "2026-10-07T10:00:00.000Z",
        },
      ],
    });

    expect(await repository.allocateLeadId("2026-10-07", WRITE_KEY)).toBe(
      "L-20261007-006",
    );
  });

  it("fails header discovery with a typed error", async () => {
    const repository = new InMemoryTrackerRepository({ headers: [] });
    await expect(repository.discoverPipelineHeaders()).rejects.toBeInstanceOf(
      TrackerSchemaError,
    );
  });
});
