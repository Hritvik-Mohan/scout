import { describe, expect, it } from "vitest";

import type {
  GoogleSheetsWorkbookTransport,
  SheetValueUpdate,
} from "../src/integrations/google-sheets.js";
import {
  buildBlindReviewRows,
  EvaluationReviewSheet,
  validateEvaluationInputs,
} from "../src/evaluation/workflow.js";

const batch = {
  schemaVersion: 1,
  batchId: "347197cc-065f-41bf-81c3-5715f16efba2",
  preparedAt: "2026-10-07T14:17:12.426Z",
  window: {
    startAt: "2026-09-30T14:17:01.247Z",
    endAt: "2026-10-07T14:17:01.247Z",
  },
  documents: Array.from({ length: 100 }, (_, index) => ({
    documentId: `doc-${String(index + 1)}`,
    sourceId: "source-1",
    sourceName: "Example RSS",
    sourceType: "rss",
    provider: "rss",
    queryOrUrl: "https://feed.example/rss",
    segment: "India — Funded startups",
    title: `Company ${String(index + 1)} raises funding`,
    summary: "A concise public funding announcement.",
    url: `https://news.example/${String(index + 1)}`,
    publishedAt: "2026-10-07T10:00:00.000Z",
    retrievedAt: "2026-10-07T11:00:00.000Z",
    publisherDomain: "news.example",
    language: null,
    sourceCountry: null,
  })),
  sourceFailures: [],
} as const;

const result = {
  schemaVersion: 1,
  batchId: batch.batchId,
  model: "codex",
  decisions: batch.documents.map((document, index) =>
    index === 0
      ? {
          documentId: document.documentId,
          status: "accepted" as const,
          candidate: {
            company: "Company 1",
            website: null,
            signal: "Funding round" as const,
            signal_date: "2026-10-07",
            signal_url: document.url,
            segment: "Seed-stage startup",
            reason: "Raised capital for growth.",
          },
        }
      : {
          documentId: document.documentId,
          status: "rejected" as const,
          reason: "no_buying_signal" as const,
          detail: "No controlled buying signal was supported.",
        },
  ),
} as const;

class FakeWorkbookTransport implements GoogleSheetsWorkbookTransport {
  readonly valueUpdates: SheetValueUpdate[] = [];
  private batches: unknown[][] = [];
  private readonly grid: unknown[][] = Array.from({ length: 101 }, () =>
    new Array<unknown>(23).fill(""),
  );

  getValues(range: string): Promise<readonly (readonly unknown[])[]> {
    return Promise.resolve(
      range === "'Evaluation Review (Blind)'!A1:W101" ? this.grid : [],
    );
  }
  batchUpdateValues(updates: readonly SheetValueUpdate[]): Promise<void> {
    this.valueUpdates.push(...updates);
    for (const update of updates) {
      const startColumn = update.range.includes("!A") ? 0 : 11;
      const startRow = update.range.includes("1:W1") ? 0 : 1;
      update.values.forEach((row, rowOffset) => {
        row.forEach((value, columnOffset) => {
          const target = this.grid[startRow + rowOffset];
          if (target !== undefined) target[startColumn + columnOffset] = value;
        });
      });
    }
    return Promise.resolve();
  }
  appendValues(): Promise<void> {
    throw new Error("appendValues should not be called");
  }
  getSpreadsheet<T>(): Promise<T> {
    return Promise.resolve({ sheets: [] } as T);
  }
  batchUpdateSpreadsheet<T>(requests: readonly unknown[]): Promise<T> {
    this.batches.push([...requests]);
    if (this.batches.length === 1) {
      return Promise.resolve({
        replies: [{ addSheet: { properties: { sheetId: 321 } } }],
      } as T);
    }
    return Promise.resolve({} as T);
  }
}

describe("P1-05 blind evaluation workflow", () => {
  it("requires one A1 decision for each of the frozen 100 documents", () => {
    expect(
      validateEvaluationInputs(batch, result).result.decisions,
    ).toHaveLength(100);
    expect(() =>
      validateEvaluationInputs(batch, {
        ...result,
        decisions: result.decisions.slice(0, 99),
      }),
    ).toThrow(/exactly one unique A1 decision/);
  });

  it("publishes A1 evidence and leaves all human inputs blank", async () => {
    const parsed = validateEvaluationInputs(batch, result);
    const rows = buildBlindReviewRows(parsed.batch, parsed.result);
    expect(rows).toHaveLength(100);
    expect(rows[0]?.slice(11)).toEqual([
      "",
      "",
      "",
      "",
      "N/A",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);

    const transport = new FakeWorkbookTransport();
    expect(
      await new EvaluationReviewSheet(transport).publish(batch, result),
    ).toEqual({
      sheetId: 321,
      created: true,
      cases: 100,
      humanCellsPreserved: false,
      verified: true,
    });
    expect(transport.valueUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          range: "'Evaluation Review (Blind)'!A2:K101",
        }),
        expect.objectContaining({
          range: "'Evaluation Review (Blind)'!L2:W101",
        }),
      ]),
    );
  });
});
