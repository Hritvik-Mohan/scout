import { describe, expect, it } from "vitest";

import {
  commitA2CodexBatch,
  prepareA2CodexBatch,
} from "../src/agents/a2-codex.js";
import { InMemoryTrackerRepository } from "../src/tracker/memory.js";

const A1_RUN = "c8f152d1-dc74-4027-bc15-49681b2a70eb";
const A2_RUN = "684085d7-908d-4d79-a9b3-d3da6a9cbbbf";
const SIGNAL_URL = "https://news.example/acme-round";

const a1Output = {
  runId: A1_RUN,
  agent: "A1" as const,
  leadId: "L-20261007-001",
  proposedOperation: "create_pipeline_lead",
  target: "Pipeline:story",
  proposedValue: {
    leadId: "L-20261007-001",
    company: "Acme",
    website: "acme.example",
    source: "Funding news",
    signal: "Funding round",
    signalDate: "2026-10-06",
    signalUrl: SIGNAL_URL,
    industry: "Technology startups",
    stage: "New",
    researchSummary: "Acme raised a seed round.",
    researchSources: [SIGNAL_URL],
    lastAgentRun: "2026-10-07T10:00:00.000Z",
    stageChangedAt: "2026-10-07T10:00:00.000Z",
    stageChangedBy: "A1",
  },
  createdAt: "2026-10-07T10:00:00.000Z",
};

const review = {
  leadId: "L-20261007-001",
  signal: {
    supported: true,
    rationale: "The announcement confirms the round.",
    sources: [SIGNAL_URL],
  },
  criteria: {
    geography: {
      market: "india" as const,
      rationale: "Acme is headquartered in Bengaluru, India.",
      sources: [SIGNAL_URL],
    },
    icpMatch: {
      tier: "primary" as const,
      caseStudy: "Maverick" as const,
      rationale: "Seed-stage technology startup.",
      sources: [SIGNAL_URL],
    },
    buyingSignalAndNeed: {
      met: true,
      rationale: "Recent raise and product build.",
      sources: [SIGNAL_URL],
    },
    budgetFit: {
      met: true,
      rationale: "The disclosed raise supports the minimum band.",
      sources: [SIGNAL_URL],
    },
    buyingProcessAndDeliveryFit: {
      met: true,
      rationale: "Founder-led software product using a supported stack.",
      sources: [SIGNAL_URL],
    },
  },
  disqualifiers: [],
  unverified: [],
};

describe("Codex-native A2", () => {
  it("prepares unreviewed A1 proposals and computes a weighted score", async () => {
    const batch = prepareA2CodexBatch(
      [a1Output],
      A2_RUN,
      "2026-10-07T12:00:00.000Z",
      10,
    );
    const tracker = new InMemoryTrackerRepository({
      dryRunOutputs: [a1Output],
    });
    const summary = await commitA2CodexBatch({
      batch,
      result: {
        schemaVersion: 1,
        batchId: A2_RUN,
        model: "codex",
        reviews: [review],
      },
      tracker,
      createdAt: "2026-10-07T12:01:00.000Z",
    });
    expect(summary.accepted).toBe(1);
    const outputs = await tracker.listDryRunOutputs();
    expect(outputs[1]?.proposedValue).toMatchObject({
      fitScore: 5,
      icpTier: "primary",
      geography: "india",
      outreachPriority: "india_first",
    });
  });

  it("forces a disqualified lead to score one", async () => {
    const batch = prepareA2CodexBatch(
      [a1Output],
      A2_RUN,
      "2026-10-07T12:00:00.000Z",
      10,
    );
    const tracker = new InMemoryTrackerRepository({
      dryRunOutputs: [a1Output],
    });
    await commitA2CodexBatch({
      batch,
      result: {
        schemaVersion: 1,
        batchId: A2_RUN,
        model: "codex",
        reviews: [
          {
            ...review,
            disqualifiers: ["hourly_or_staff_augmentation" as const],
          },
        ],
      },
      tracker,
    });
    expect((await tracker.listDryRunOutputs())[1]?.proposedValue).toMatchObject(
      { fitScore: 1 },
    );
  });

  it("ranks international leads second without changing fit score", async () => {
    const batch = prepareA2CodexBatch(
      [a1Output],
      A2_RUN,
      "2026-10-07T12:00:00.000Z",
      10,
    );
    const tracker = new InMemoryTrackerRepository({
      dryRunOutputs: [a1Output],
    });
    await commitA2CodexBatch({
      batch,
      result: {
        schemaVersion: 1,
        batchId: A2_RUN,
        model: "codex",
        reviews: [
          {
            ...review,
            criteria: {
              ...review.criteria,
              geography: {
                market: "international" as const,
                rationale: "Acme is headquartered outside India.",
                sources: [SIGNAL_URL],
              },
            },
          },
        ],
      },
      tracker,
    });
    expect((await tracker.listDryRunOutputs())[1]?.proposedValue).toMatchObject(
      {
        fitScore: 5,
        geography: "international",
        outreachPriority: "international_second",
      },
    );
  });
});
