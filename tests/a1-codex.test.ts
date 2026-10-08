import { describe, expect, it } from "vitest";

import {
  commitA1CodexBatch,
  prepareA1CodexBatch,
  type DiscoveryAdapter,
  type DiscoveryRequest,
} from "../src/index.js";
import { InMemoryTrackerRepository } from "../src/tracker/memory.js";

const BATCH_ID = "684085d7-908d-4d79-a9b3-d3da6a9cbbbf";
const NOW = "2026-10-07T10:00:00.000Z";

const source = {
  sourceId: "funding-search",
  sourceName: "Funding announcements",
  type: "search_query" as const,
  queryOrUrl: '"funding round"',
  segment: "funded startups",
  active: true,
  lastSuccessfulFetch: null,
  cursorOrCheckpoint: null,
  error: null,
};

const adapter: DiscoveryAdapter = {
  provider: "fixture",
  sourceType: "search_query",
  discover(request: DiscoveryRequest) {
    return Promise.resolve([
      {
        documentId: "story-1",
        sourceId: request.source.sourceId,
        sourceName: request.source.sourceName,
        sourceType: "search_query",
        provider: "fixture",
        queryOrUrl: request.source.queryOrUrl,
        segment: request.source.segment,
        title: "Acme raises seed funding",
        url: "https://news.example/acme?utm_source=test#section",
        publishedAt: "2026-10-06T12:00:00.000Z",
        retrievedAt: NOW,
        summary: "Acme announced a seed round.",
        publisherDomain: "news.example",
        language: "English",
        sourceCountry: "India",
      },
    ]);
  },
};

const prepare = () =>
  prepareA1CodexBatch({
    batchId: BATCH_ID,
    sources: [source],
    adapters: [adapter],
    startAt: new Date("2026-10-05T10:00:00.000Z"),
    endAt: new Date(NOW),
    maxDocuments: 10,
    now: () => new Date(NOW),
  });

describe("Codex-native A1", () => {
  it("prepares a bounded batch and canonicalizes evidence URLs", async () => {
    const batch = await prepare();
    expect(batch.documents).toHaveLength(1);
    expect(batch.documents[0]).toMatchObject({
      segment: "funded startups",
      url: "https://news.example/acme",
    });
    expect(batch.sourceFailures).toEqual([]);
  });

  it("validates Codex output and writes only an A1 dry-run proposal", async () => {
    const batch = await prepare();
    const tracker = new InMemoryTrackerRepository();
    const summary = await commitA1CodexBatch({
      batch,
      result: {
        schemaVersion: 1,
        batchId: BATCH_ID,
        model: "codex",
        decisions: [
          {
            documentId: "story-1",
            status: "accepted",
            candidate: {
              company: "Acme Private Limited",
              website: "https://www.acme.example/about",
              signal: "Funding round",
              signal_date: "2026-10-06",
              signal_url: "https://news.example/acme",
              segment: "funded startups",
              reason: "Acme publicly announced a seed funding round.",
            },
          },
        ],
      },
      tracker,
      dailyCap: 20,
      createdAt: NOW,
    });

    expect(summary).toMatchObject({ accepted: 1, rejectedDuplicate: 0 });
    expect(await tracker.listLeads()).toEqual([]);
    const outputs = await tracker.listDryRunOutputs();
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({
      agent: "A1",
      proposedOperation: "create_pipeline_lead",
      leadId: "L-20261007-001",
    });
    expect(outputs[0]?.proposedValue).toMatchObject({
      company: "Acme Private Limited",
      website: "acme.example",
      source: "Funding news",
    });
  });

  it("fails closed for DNC and evidence mismatches", async () => {
    const batch = await prepare();
    const tracker = new InMemoryTrackerRepository({
      doNotContact: [
        {
          emailOrDomain: "acme.example",
          normalizedValue: "acme.example",
          kind: "domain",
          added: "2026-10-01",
          reason: "manual",
          sourceLeadId: null,
          addedBy: "owner",
        },
      ],
    });
    const baseCandidate = {
      company: "Acme",
      website: "acme.example",
      signal: "Funding round" as const,
      signal_date: "2026-10-06",
      signal_url: "https://news.example/acme",
      segment: "funded startups",
      reason: "Acme publicly announced a seed funding round.",
    };

    const dncSummary = await commitA1CodexBatch({
      batch,
      result: {
        schemaVersion: 1,
        batchId: BATCH_ID,
        model: "codex",
        decisions: [
          {
            documentId: "story-1",
            status: "accepted",
            candidate: baseCandidate,
          },
        ],
      },
      tracker,
      dailyCap: 20,
      createdAt: NOW,
    });
    expect(dncSummary.rejectedDnc).toBe(1);

    const invalidSummary = await commitA1CodexBatch({
      batch,
      result: {
        schemaVersion: 1,
        batchId: BATCH_ID,
        model: "codex",
        decisions: [
          {
            documentId: "story-1",
            status: "accepted",
            candidate: { ...baseCandidate, signal_date: "2026-10-05" },
          },
        ],
      },
      tracker: new InMemoryTrackerRepository(),
      dailyCap: 20,
      createdAt: NOW,
    });
    expect(invalidSummary.rejectedInvalidEvidence).toBe(1);
  });
});
