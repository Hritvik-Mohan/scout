import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { GoogleSheetsWorkbookTransport } from "../src/integrations/google-sheets.js";
import { boardSlugCandidates } from "../src/jobs/board-detection.js";
import {
  readSearchRepoState,
  searchRepoWarning,
  syncSearchRepo,
} from "../src/jobs/search-repo.js";
import { JobReviewSheetRepository } from "../src/jobs/review-sheet.js";
import { stripMarkup } from "../src/jobs/text.js";
import {
  buildJobDigest,
  buildOutcomeReport,
  fitSummary,
  freshnessPenalty,
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
    appliedOn?: string;
    stage?: string;
    flags?: string;
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
  row[18] = options.appliedOn ?? "";
  row[19] = options.stage ?? "Discovered";
  row[22] = options.flags ?? "";
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

  it("ranks open roles by fit less a freshness penalty", () => {
    const digest = buildJobDigest(
      [
        pipelineRow("a", { fit: 60, verdict: "apply" }),
        pipelineRow("b", { fit: 90, verdict: "apply_now" }),
        pipelineRow("c", { fit: 95, verdict: "apply_now", applied: true }),
        pipelineRow("d", { fit: 20, verdict: "skip" }),
        pipelineRow("e", { posted: "2026-03-01" }),
        pipelineRow("f", { fit: 75, verdict: "apply", posted: "2026-03-01" }),
        pipelineRow("g", {
          fit: 70,
          verdict: "apply",
          applied: true,
          appliedOn: "2026-09-25",
          stage: "Applied",
        }),
      ],
      { now: new Date("2026-10-09T00:00:00Z") },
    );
    expect(digest).toContain("7 roles, 2 applied, 1 awaiting review");
    expect(digest.indexOf("Role b")).toBeLessThan(digest.indexOf("Role a"));
    expect(digest.indexOf("Role a")).toBeLessThan(digest.indexOf("Role f"));
    expect(digest).toContain("fit 75 (-20, posted 222 days ago)");
    expect(digest).not.toContain("fit 20");
    expect(digest).toContain("Row 8 | applied 14 days ago");
    expect(freshnessPenalty(50)).toBe(10);
    expect(freshnessPenalty(10)).toBe(0);
  });

  it("reports outcomes by verdict, level and source", () => {
    const now = new Date("2026-10-09T00:00:00Z");
    expect(buildOutcomeReport([pipelineRow("a", {})], now)).toContain(
      "no applications recorded yet",
    );
    const report = buildOutcomeReport(
      [
        pipelineRow("lever:x:1", {
          applied: true,
          stage: "Interview",
          verdict: "apply_now",
        }),
        pipelineRow("lever:x:2", {
          applied: true,
          stage: "Applied",
          verdict: "apply_now",
        }),
        pipelineRow("ashby:y:3", {
          stage: "Rejected",
          verdict: "stretch",
          flags: "Senior title - above SDE I/II target",
        }),
        pipelineRow("ashby:y:4", {}),
      ],
      now,
    );
    expect(report).toContain(
      "Outcomes: 3 applied, 2 responses (67%), 1 interviews or offers (33%).",
    );
    expect(report).toContain("Fewer than 10 applications");
    expect(report).toContain("- apply_now: 2 applied, 1 responses (50%)");
    expect(report).toContain("- senior title: 1 applied, 1 responses (100%)");
    expect(report).toContain("- lever: 2 applied");
  });

  it("derives board identifiers from company names", () => {
    expect(boardSlugCandidates("Hevo Data")).toEqual(["hevodata", "hevo-data"]);
    expect(boardSlugCandidates("Sarvam AI Pvt Ltd")).toEqual([
      "sarvamaipvtltd",
      "sarvam-ai-pvt-ltd",
      "sarvam",
    ]);
    expect(boardSlugCandidates("Ema")).toEqual([]);
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
      "'Application Kit'!A1:J1",
      "'Job Pipeline'!X3:AA3",
      "'Application Kit'!A3:I3",
    ]);
    expect(writes[1]?.values[0]?.slice(0, 2)).toEqual([82, "apply_now"]);
  });
});

describe("private search repository", () => {
  const run = (directory: string, args: string[]): string =>
    execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" });

  it("warns only when edits have not been pushed", () => {
    const clean = { isRepo: true, dirty: false, ahead: 0, hasRemote: true };
    expect(searchRepoWarning(clean)).toBeNull();
    expect(searchRepoWarning({ ...clean, isRepo: false })).toBeNull();
    expect(searchRepoWarning({ ...clean, dirty: true })).toContain(
      "not committed",
    );
    expect(searchRepoWarning({ ...clean, ahead: 2 })).toContain(
      "2 commit(s) that are not pushed",
    );
  });

  it("commits and pushes changes to the remote", () => {
    const root = mkdtempSync(join(tmpdir(), "scout-search-"));
    const remote = join(root, "remote.git");
    const work = join(root, "my-search");
    run(root, ["init", "-q", "--bare", "-b", "main", remote]);
    run(root, ["init", "-q", "-b", "main", work]);
    run(work, ["config", "user.email", "test@example.test"]);
    run(work, ["config", "user.name", "Test"]);
    run(work, ["config", "commit.gpgsign", "false"]);
    run(work, ["remote", "add", "origin", remote]);
    expect(readSearchRepoState(join(root, "missing")).isRepo).toBe(false);

    writeFileSync(join(work, "jobs.json"), "{}\n");
    expect(readSearchRepoState(work).dirty).toBe(true);
    const first = syncSearchRepo(work);
    expect(first).toMatchObject({ committed: true, pushed: true });
    expect(first.state).toMatchObject({ dirty: false, ahead: 0 });
    expect(
      run(remote, ["log", "--oneline", "main"]).trim().split("\n"),
    ).toHaveLength(1);
    expect(syncSearchRepo(work)).toMatchObject({
      committed: false,
      pushed: false,
    });
    rmSync(root, { recursive: true, force: true });
  });
});
