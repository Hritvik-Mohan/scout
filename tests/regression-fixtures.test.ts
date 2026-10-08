import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  buyingSignalsFixtureSchema,
  historicalTranscriptsFixtureSchema,
  labelledRepliesFixtureSchema,
  promptRegressionFixtureSchema,
  sampleLeadsFixtureSchema,
  trackerWorkbookFixtureSchema,
} from "../src/models/fixtures.js";
import type { PipelineLead } from "../src/models/tracker.js";
import { InMemoryTrackerRepository } from "../src/tracker/memory.js";

async function loadFixture(name: string): Promise<unknown> {
  const raw = await readFile(new URL(`./fixtures/${name}`, import.meta.url), {
    encoding: "utf8",
  });
  return JSON.parse(raw) as unknown;
}

function fixtureCell(header: string, lead: PipelineLead): unknown {
  switch (header) {
    case "Company":
      return lead.company;
    case "Website":
      return lead.website ?? "";
    case "Lead ID":
      return lead.leadId;
    case "Source":
      return lead.source;
    case "Signal":
      return lead.signal;
    case "Stage":
      return lead.stage;
    case "Fit (1-5)":
      return lead.fit ?? "";
    case "Touches":
      return lead.touches;
    case "Reply class":
      return lead.replyClass ?? "";
    default:
      return "";
  }
}

describe("Phase 0 regression fixture pack", () => {
  it("validates the required synthetic fixture counts and formats", async () => {
    const [leads, replies, signals, transcripts, snapshots, tracker] =
      await Promise.all([
        loadFixture("sample-leads.json"),
        loadFixture("labelled-replies.json"),
        loadFixture("buying-signals.json"),
        loadFixture("historical-transcripts.json"),
        loadFixture("prompt-regression.json"),
        loadFixture("tracker-reordered.json"),
      ]);

    expect(sampleLeadsFixtureSchema.parse(leads).records).toHaveLength(10);
    expect(labelledRepliesFixtureSchema.parse(replies).records).toHaveLength(
      30,
    );
    expect(buyingSignalsFixtureSchema.parse(signals).records).toHaveLength(5);
    expect(
      historicalTranscriptsFixtureSchema.parse(transcripts).records,
    ).toHaveLength(3);
    expect(
      promptRegressionFixtureSchema.parse(snapshots).records.length,
    ).toBeGreaterThan(0);
    expect(trackerWorkbookFixtureSchema.parse(tracker).headers).toHaveLength(
      44,
    );
  });

  it("contains only reserved example.com network identities", async () => {
    const fixtures = await Promise.all([
      loadFixture("sample-leads.json"),
      loadFixture("buying-signals.json"),
    ]);
    const serialized = JSON.stringify(fixtures);
    const urls = serialized.match(/https:\/\/[^"\\]+/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    expect(
      urls.every((url) => new URL(url).hostname.endsWith("example.com")),
    ).toBe(true);
  });

  it("loads all leads through a tracker with reordered columns", async () => {
    const leads = sampleLeadsFixtureSchema.parse(
      await loadFixture("sample-leads.json"),
    ).records;
    const trackerFixture = trackerWorkbookFixtureSchema.parse(
      await loadFixture("tracker-reordered.json"),
    );
    const repository = new InMemoryTrackerRepository({
      headers: trackerFixture.headers,
      rows: leads.map((lead) =>
        trackerFixture.headers.map((header) => fixtureCell(header, lead)),
      ),
    });

    const parsed = await repository.listLeads();
    expect(parsed).toHaveLength(10);
    expect(parsed.map(({ leadId }) => leadId)).toEqual(
      leads.map(({ leadId }) => leadId),
    );
  });

  it("is byte-for-byte stable under parse and canonical formatting", async () => {
    const first = sampleLeadsFixtureSchema.parse(
      await loadFixture("sample-leads.json"),
    );
    const second = sampleLeadsFixtureSchema.parse(
      await loadFixture("sample-leads.json"),
    );
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
