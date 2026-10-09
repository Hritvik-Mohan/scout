import { describe, expect, it } from "vitest";

import type { GoogleSheetsWorkbookTransport } from "../src/integrations/google-sheets.js";
import { JobReviewSheetRepository } from "../src/jobs/review-sheet.js";
import { stripMarkup } from "../src/jobs/text.js";
import {
  buildJobDigest,
  fitSummary,
  jobReviewSchema,
  type JobReview,
} from "../src/jobs/review.js";

const review = (overrides: Partial<JobReview> = {}): JobReview => ({
  id: "lever:example:abc",
  fit: 82,
  verdict: "apply_now",
  reasons: ["Backend SDE II scope", "Distributed systems work"],
  gaps: ["Java preferred"],
  leadWith: ["Built the simulator routing engine"],
  outreach: "Hello, I am interested in the SDE II role.",
  ...overrides,
});

const pipelineRow = (
  id: string,
  options: {
    applied?: boolean;
    fit?: number;
    verdict?: string;
    posted?: string;
  },
): unknown[] => {
  const row: unknown[] = Array.from({ length: 27 }, () => "");
  row[0] = id;
  row[1] = `Role ${id}`;
  row[2] = "Example";
  row[3] = `https://example.com/${id}`;
  row[4] = options.posted ?? "2026-10-01";
  row[17] = options.applied ?? false;
  row[23] = options.fit ?? "";
  row[24] = options.verdict ?? "";
  return row;
};

describe("stripMarkup", () => {
  it("decodes entity-escaped HTML before stripping tags", () => {
    expect(
      stripMarkup("&lt;p&gt;3+ years&amp;nbsp;of R&amp;amp;D&lt;/p&gt;"),
    ).toBe("3+ years of R&D");
  });
});

describe("job reviews", () => {
  it("rejects out-of-range fit and unknown fields", () => {
    expect(jobReviewSchema.safeParse(review({ fit: 101 })).success).toBe(false);
    expect(
      jobReviewSchema.safeParse({ ...review(), email: "x@example.com" })
        .success,
    ).toBe(false);
    expect(jobReviewSchema.safeParse(review()).success).toBe(true);
  });

  it("summarizes reasons and gaps", () => {
    expect(fitSummary(review())).toBe(
      "Why: Backend SDE II scope; Distributed systems work\nGaps: Java preferred",
    );
    expect(fitSummary(review({ gaps: [] }))).toBe(
      "Why: Backend SDE II scope; Distributed systems work",
    );
  });

  it("ranks open reviewed roles and lists stale postings", () => {
    const digest = buildJobDigest(
      [
        pipelineRow("a", { fit: 60, verdict: "apply" }),
        pipelineRow("b", { fit: 90, verdict: "apply_now" }),
        pipelineRow("c", { fit: 95, verdict: "apply_now", applied: true }),
        pipelineRow("d", { fit: 20, verdict: "skip" }),
        pipelineRow("e", { posted: "2026-03-01" }),
      ],
      { now: new Date("2026-10-09T00:00:00Z") },
    );
    expect(digest).toContain("5 roles, 1 applied, 1 awaiting review");
    expect(digest.indexOf("Role b")).toBeLessThan(digest.indexOf("Role a"));
    expect(digest).not.toContain("Role c |");
    expect(digest).not.toContain("fit 20");
    expect(digest).toContain("Row 6 | 222 days");
  });

  it("writes review columns and drafts without touching human columns", async () => {
    const writes: { range: string; values: readonly (readonly unknown[])[] }[] =
      [];
    const transport: GoogleSheetsWorkbookTransport = {
      getValues: (range) =>
        Promise.resolve(
          range.startsWith("'Job Pipeline'")
            ? [pipelineRow("other", {}), pipelineRow("lever:example:abc", {})]
            : [["existing:1"]],
        ),
      batchUpdateValues: (updates) => {
        writes.push(...updates);
        return Promise.resolve();
      },
      appendValues: () => Promise.resolve(),
      getSpreadsheet: <T>() =>
        Promise.resolve({
          sheets: [{ properties: { title: "Application Kit" } }],
        } as T),
      batchUpdateSpreadsheet: <T>() => Promise.resolve({} as T),
    };
    const result = await new JobReviewSheetRepository(transport).applyReviews(
      [review(), review({ id: "missing:1" })],
      "2026-10-09T00:00:00.000Z",
    );
    expect(result).toEqual({ applied: 1, unknownIds: ["missing:1"] });
    expect(writes.map((write) => write.range)).toEqual([
      "'Application Kit'!A1:I1",
      "'Job Pipeline'!X3:AA3",
      "'Application Kit'!A3:I3",
    ]);
    expect(writes[1]?.values[0]?.slice(0, 2)).toEqual([82, "apply_now"]);
  });
});
