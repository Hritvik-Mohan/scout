import { describe, expect, it } from "vitest";

import {
  evidenceSchema,
  isoDateSchema,
  leadIdSchema,
} from "../src/models/common.js";
import { AGENT_IDS, PIPELINE_AGENT_IDS, STAGES } from "../src/models/enums.js";
import {
  capacityRowSchema,
  doNotContactRowSchema,
  outboundMessageRowSchema,
  PIPELINE_HEADERS,
  pipelineLeadSchema,
  runRowSchema,
  sourceRowSchema,
} from "../src/models/tracker.js";

describe("shared domain primitives", () => {
  it("accepts real ISO dates and rejects impossible ones", () => {
    expect(isoDateSchema.safeParse("2026-10-06").success).toBe(true);
    expect(isoDateSchema.safeParse("2026-02-30").success).toBe(false);
    expect(isoDateSchema.safeParse("06-10-2026").success).toBe(false);
  });

  it("enforces the specified lead ID format", () => {
    expect(leadIdSchema.safeParse("L-20261006-001").success).toBe(true);
    expect(
      leadIdSchema.safeParse("3f9df4aa-84d0-4a74-a68b-920ccfdbd011").success,
    ).toBe(false);
  });

  it("keeps one canonical agent and stage catalogue", () => {
    expect(AGENT_IDS).toHaveLength(9);
    expect(PIPELINE_AGENT_IDS).toHaveLength(8);
    expect(STAGES).toHaveLength(12);
  });

  it("requires evidence to include a claim, source, and retrieval time", () => {
    expect(
      evidenceSchema.safeParse({
        claim: "The company announced a seed round.",
        sourceUrl: "https://example.com/news",
        retrievedAt: "2026-10-06T10:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      evidenceSchema.safeParse({
        claim: "Unsupported claim",
        retrievedAt: "2026-10-06T10:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("tracker schemas", () => {
  it("defines 44 unique Pipeline headers", () => {
    expect(PIPELINE_HEADERS).toHaveLength(44);
    expect(new Set(PIPELINE_HEADERS).size).toBe(44);
  });

  it("parses a minimal canonical lead and supplies safe defaults", () => {
    const lead = pipelineLeadSchema.parse({
      leadId: "L-20261006-001",
      company: "Example Labs",
      source: "Funding news",
      signal: "Funding round",
      stage: "New",
    });

    expect(lead.approved).toBe(false);
    expect(lead.touches).toBe(0);
    expect(lead.researchSources).toEqual([]);
    expect(lead.notes).toBe("");
  });

  it("rejects unknown lead fields", () => {
    expect(
      pipelineLeadSchema.safeParse({
        leadId: "L-20261006-001",
        company: "Example Labs",
        source: "Funding news",
        signal: "Funding round",
        stage: "New",
        inventedField: true,
      }).success,
    ).toBe(false);
  });

  it("validates every operational row type", () => {
    expect(
      runRowSchema.safeParse({
        runId: "55dd44f3-040d-4375-a405-7354d997162f",
        agent: "A0",
        started: "2026-10-06T10:00:00.000Z",
        finished: "2026-10-06T10:00:01.000Z",
        status: "success",
        leadsProcessed: 0,
        leadIds: [],
        llmModel: null,
        inputTokens: 0,
        outputTokens: 0,
        error: null,
        dryRun: true,
        trigger: "manual_test",
        correlationId: "01248b8c-7d02-420a-834d-f576376c7dbe",
      }).success,
    ).toBe(true);
    expect(
      doNotContactRowSchema.safeParse({
        emailOrDomain: "example.com",
        normalizedValue: "example.com",
        kind: "domain",
        added: "2026-10-06",
        reason: "manual",
        addedBy: "owner",
      }).success,
    ).toBe(true);
    expect(
      capacityRowSchema.safeParse({
        month: "2026-10",
        availablePods: 4,
        committedPods: 2,
        updatedBy: "owner",
        updatedAt: "2026-10-06T10:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      sourceRowSchema.safeParse({
        sourceId: "source-1",
        sourceName: "Funding search",
        type: "search_query",
        queryOrUrl: "startup funding India",
        segment: "funded startups",
        active: true,
      }).success,
    ).toBe(true);
    expect(
      outboundMessageRowSchema.safeParse({
        outboundId: "9be13d7d-dcbd-43b7-8647-41628d711126",
        leadId: "L-20261006-001",
        touchNumber: 1,
        channel: "Email",
        status: "drafted",
        gmailDraftId: "draft-1",
        createdAt: "2026-10-06T10:00:00.000Z",
        runId: "55dd44f3-040d-4375-a405-7354d997162f",
      }).success,
    ).toBe(true);
  });

  it("enforces cross-field operational invariants", () => {
    expect(
      outboundMessageRowSchema.safeParse({
        outboundId: "9be13d7d-dcbd-43b7-8647-41628d711126",
        leadId: "L-20261006-001",
        touchNumber: 1,
        channel: "Email",
        status: "sent",
        createdAt: "2026-10-06T10:00:00.000Z",
        runId: "55dd44f3-040d-4375-a405-7354d997162f",
      }).success,
    ).toBe(false);
  });
});
