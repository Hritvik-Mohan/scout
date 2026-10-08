import { describe, expect, it } from "vitest";

import type {
  GoogleSheetsTransport,
  SheetValueUpdate,
} from "../src/integrations/google-sheets.js";
import type { DryRunOutputRow } from "../src/models/tracker.js";
import { LeadReviewSheet } from "../src/review/lead-review.js";

const A1 = {
  leadId: "L-20261007-001",
  company: "Example AI",
  website: "https://example.ai/",
  source: "Funding news",
  signal: "Funding round",
  signalDate: "2026-10-06",
  signalUrl: "https://example.ai/news",
  industry: "AI software",
  stage: "New",
  researchSummary: "Raised a seed round.",
  researchSources: ["https://example.ai/news"],
  lastAgentRun: "2026-10-07T10:00:00.000Z",
  stageChangedAt: "2026-10-07T10:00:00.000Z",
  stageChangedBy: "A1",
} as const;

const A2 = {
  leadId: A1.leadId,
  signalSupported: true,
  fitScore: 5,
  fitPoints: ["primary_icp", "primary_icp_weight"],
  icpTier: "primary",
  geography: "india",
  outreachPriority: "india_first",
  caseStudy: "Maverick",
  criteria: {
    icpMatch: { rationale: "Seed-stage startup." },
    buyingSignalAndNeed: { rationale: "Has a current product trigger." },
  },
  disqualifiers: [],
  sources: ["https://example.ai/news"],
  unverified: ["Exact delivery need"],
  contact: {
    decisionMaker: "Asha Founder",
    role: "Founder",
    publicEmail: "asha@example.ai",
    emailUsability: "usable_for_outreach",
    emailSource: "https://example.ai/contact",
  },
} as const;

const outputs: DryRunOutputRow[] = [
  {
    runId: "684085d7-908d-4d79-a9b3-d3da6a9cbbbf",
    agent: "A1",
    leadId: A1.leadId,
    proposedOperation: "create_pipeline_lead",
    target: `Pipeline:${A1.leadId}`,
    proposedValue: A1,
    createdAt: "2026-10-07T10:00:00.000Z",
  },
  {
    runId: "377fcd88-7009-4cbf-9a26-a5f63d233f62",
    agent: "A2",
    leadId: A1.leadId,
    proposedOperation: "verify_and_score_lead",
    target: `Dry Run Output:${A1.leadId}`,
    proposedValue: A2,
    createdAt: "2026-10-07T10:01:00.000Z",
  },
];

class FakeTransport implements GoogleSheetsTransport {
  readonly updates: SheetValueUpdate[] = [];
  constructor(readonly rows: unknown[][]) {}
  getValues(): Promise<readonly (readonly unknown[])[]> {
    return Promise.resolve(this.rows);
  }
  batchUpdateValues(updates: readonly SheetValueUpdate[]): Promise<void> {
    this.updates.push(...updates);
    return Promise.resolve();
  }
  appendValues(): Promise<void> {
    throw new Error("appendValues should not be called");
  }
}

describe("Lead Review sheet", () => {
  it("creates one human-readable row from joined A1 and A2 output", async () => {
    const transport = new FakeTransport([]);
    expect(await new LeadReviewSheet(transport).sync(outputs)).toEqual({
      created: 1,
      updated: 0,
      unchanged: 0,
    });
    expect(transport.updates[0]?.range).toBe("'Lead Review'!A2:X2");
    expect(transport.updates[0]?.values[0]).toEqual(
      expect.arrayContaining([
        A1.leadId,
        "Example AI",
        "India",
        "asha@example.ai",
        "Research",
      ]),
    );
  });

  it("preserves human-owned location, contact, review status and next action", async () => {
    const existing = new Array<unknown>(24).fill("");
    existing[0] = A1.leadId;
    existing[3] = "Bengaluru";
    existing[14] = "Manual Contact";
    existing[16] = "manual@example.ai";
    existing[17] = "manually verified";
    existing[22] = "Approve for Pipeline";
    existing[23] = "Call Thursday";
    const transport = new FakeTransport([existing]);
    await new LeadReviewSheet(transport).sync(outputs);

    expect(transport.updates.map((update) => update.range)).not.toEqual(
      expect.arrayContaining([
        "'Lead Review'!D2",
        "'Lead Review'!O2",
        "'Lead Review'!Q2",
        "'Lead Review'!R2",
        "'Lead Review'!W2",
        "'Lead Review'!X2",
      ]),
    );
  });
});
