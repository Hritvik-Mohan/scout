import { z } from "zod";

export const JOB_REVIEW_VERDICTS = [
  "apply_now",
  "apply",
  "stretch",
  "skip",
] as const;

/**
 * A human-or-model reading of one kept posting against the job-search ICP.
 * Reviews rank the pipeline and carry application drafts; nothing here is ever
 * sent or submitted by Scout.
 */
export const jobReviewSchema = z
  .object({
    id: z.string().trim().min(1),
    fit: z.number().int().min(0).max(100),
    verdict: z.enum(JOB_REVIEW_VERDICTS),
    reasons: z.array(z.string().trim().min(1)).min(1).max(3),
    gaps: z.array(z.string().trim().min(1)).max(3),
    // Drafts may be empty when the verdict is "skip".
    leadWith: z.array(z.string().trim().min(1)).max(5),
    outreach: z.string().trim().max(1200),
  })
  .strict();

export const jobReviewFileSchema = z.array(jobReviewSchema).min(1);

export type JobReview = z.infer<typeof jobReviewSchema>;

export const fitSummary = (review: JobReview): string =>
  [
    `Why: ${review.reasons.join("; ")}`,
    review.gaps.length === 0 ? "" : `Gaps: ${review.gaps.join("; ")}`,
  ]
    .filter(Boolean)
    .join("\n");

const text = (value: unknown): string => {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
};

export interface JobDigestOptions {
  now: Date;
  top?: number;
  staleDays?: number;
}

/**
 * Builds the daily digest from Job Pipeline rows (A2:AA). Row positions follow
 * JOB_PIPELINE_HEADERS.
 */
export function buildJobDigest(
  rows: readonly (readonly unknown[])[],
  options: JobDigestOptions,
): string {
  const top = options.top ?? 5;
  const staleDays = options.staleDays ?? 45;
  const entries = rows.flatMap((row, index) => {
    if (text(row[0]).trim() === "") return [];
    const posted = Date.parse(text(row[4]));
    return [
      {
        rowNumber: index + 2,
        role: text(row[1]),
        company: text(row[2]),
        url: text(row[3]),
        ageDays: Number.isNaN(posted)
          ? null
          : Math.floor((options.now.valueOf() - posted) / 86_400_000),
        applied: row[17] === true || text(row[17]).toLowerCase() === "true",
        flags: text(row[22]),
        fit: text(row[23]).trim() === "" ? null : Number(row[23]),
        verdict: text(row[24]),
      },
    ];
  });
  const open = entries.filter((entry) => !entry.applied);
  const queue = open
    .filter((entry) => entry.fit !== null && entry.verdict !== "skip")
    .sort((left, right) => (right.fit ?? 0) - (left.fit ?? 0))
    .slice(0, top);
  const stale = open.filter(
    (entry) => entry.ageDays !== null && entry.ageDays > staleDays,
  );
  const lines = [
    `Pipeline: ${String(entries.length)} roles, ${String(entries.length - open.length)} applied, ${String(open.filter((entry) => entry.fit === null).length)} awaiting review.`,
    "",
    `Apply next (top ${String(queue.length)} by fit):`,
    ...(queue.length === 0
      ? ["- Nothing reviewed and open."]
      : queue.map(
          (entry) =>
            `- Row ${String(entry.rowNumber)} | fit ${String(entry.fit)} (${entry.verdict}) | ${entry.company} - ${entry.role} | ${entry.url}${entry.flags === "" ? "" : ` | Flags: ${entry.flags}`}`,
        )),
  ];
  if (stale.length > 0) {
    lines.push(
      "",
      `Posted more than ${String(staleDays)} days ago and not applied (confirm still open):`,
      ...stale.map(
        (entry) =>
          `- Row ${String(entry.rowNumber)} | ${String(entry.ageDays)} days | ${entry.company} - ${entry.role}`,
      ),
    );
  }
  return lines.join("\n");
}
