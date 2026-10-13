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
    // Public, sourced routes to a referral. Never a guessed contact.
    referralPath: z.string().trim().max(2000).optional(),
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
  followUpDays?: number;
}

const RESPONDED_STAGES = new Set(["Interview", "Offer", "Rejected"]);
const POSITIVE_STAGES = new Set(["Interview", "Offer"]);

interface PipelineEntry {
  rowNumber: number;
  role: string;
  company: string;
  url: string;
  source: string;
  ageDays: number | null;
  applied: boolean;
  appliedDaysAgo: number | null;
  stage: string;
  flags: string;
  fit: number | null;
  verdict: string;
}

// Sheets returns dates as serial numbers when the cell is date-formatted.
const parseSheetDate = (value: unknown): number => {
  if (typeof value === "number") {
    return Date.UTC(1899, 11, 30) + value * 86_400_000;
  }
  return Date.parse(text(value));
};

const daysSince = (value: unknown, now: Date): number | null => {
  const parsed = parseSheetDate(value);
  return Number.isNaN(parsed)
    ? null
    : Math.floor((now.valueOf() - parsed) / 86_400_000);
};

/** Row positions follow JOB_PIPELINE_HEADERS (A2:AA). */
const pipelineEntries = (
  rows: readonly (readonly unknown[])[],
  now: Date,
): PipelineEntry[] =>
  rows.flatMap((row, index) => {
    const id = text(row[0]).trim();
    if (id === "") return [];
    const stage = text(row[19]).trim();
    return [
      {
        rowNumber: index + 2,
        role: text(row[1]),
        company: text(row[2]),
        url: text(row[3]),
        source: id.split(":")[0] ?? "",
        ageDays: daysSince(row[4], now),
        applied:
          row[17] === true ||
          text(row[17]).toLowerCase() === "true" ||
          stage === "Applied" ||
          RESPONDED_STAGES.has(stage),
        appliedDaysAgo: daysSince(row[18], now),
        stage,
        flags: text(row[22]),
        fit: text(row[23]).trim() === "" ? null : Number(row[23]),
        verdict: text(row[24]),
      },
    ];
  });

/** Older postings are less likely to be open, so they rank lower. */
export const freshnessPenalty = (
  ageDays: number | null,
  staleDays = 45,
): number => {
  if (ageDays === null || ageDays <= staleDays) return 0;
  return ageDays > staleDays * 2 ? 20 : 10;
};

/** Builds the daily digest from Job Pipeline rows (A2:AA). */
export function buildJobDigest(
  rows: readonly (readonly unknown[])[],
  options: JobDigestOptions,
): string {
  const top = options.top ?? 5;
  const staleDays = options.staleDays ?? 45;
  const followUpDays = options.followUpDays ?? 7;
  const entries = pipelineEntries(rows, options.now);
  const open = entries.filter(
    (entry) =>
      !entry.applied &&
      entry.stage !== "Withdrawn" &&
      !entry.flags.includes("Closed -"),
  );
  const queue = open
    .filter((entry) => entry.fit !== null && entry.verdict !== "skip")
    .map((entry) => {
      const penalty = freshnessPenalty(entry.ageDays, staleDays);
      return { ...entry, penalty, rank: (entry.fit ?? 0) - penalty };
    })
    .sort((left, right) => right.rank - left.rank)
    .slice(0, top);
  const followUps = entries.filter(
    (entry) =>
      entry.applied &&
      !RESPONDED_STAGES.has(entry.stage) &&
      entry.stage !== "Withdrawn" &&
      entry.appliedDaysAgo !== null &&
      entry.appliedDaysAgo >= followUpDays,
  );
  const lines = [
    `Pipeline: ${String(entries.length)} roles, ${String(entries.filter((entry) => entry.applied).length)} applied, ${String(open.filter((entry) => entry.fit === null).length)} awaiting review.`,
    "",
    `Apply next (top ${String(queue.length)}, ranked by fit less a penalty for old postings):`,
    ...(queue.length === 0
      ? ["- Nothing reviewed and open."]
      : queue.map(
          (entry) =>
            `- Row ${String(entry.rowNumber)} | fit ${String(entry.fit)}${entry.penalty === 0 ? "" : ` (-${String(entry.penalty)}, posted ${String(entry.ageDays)} days ago)`} (${entry.verdict}) | ${entry.company} - ${entry.role} | ${entry.url}${entry.flags === "" ? "" : ` | Flags: ${entry.flags}`}`,
        )),
  ];
  if (followUps.length > 0) {
    lines.push(
      "",
      `Follow up (applied ${String(followUpDays)}+ days ago, no response recorded):`,
      ...followUps.map(
        (entry) =>
          `- Row ${String(entry.rowNumber)} | applied ${String(entry.appliedDaysAgo)} days ago | ${entry.company} - ${entry.role}`,
      ),
    );
  }
  return lines.join("\n");
}

const rate = (part: number, whole: number): string =>
  whole === 0 ? "n/a" : `${String(Math.round((part / whole) * 100))}%`;

/**
 * Summarizes application outcomes from the human-maintained Applied and Stage
 * columns, grouped so the search can be retuned on evidence.
 */
export function buildOutcomeReport(
  rows: readonly (readonly unknown[])[],
  now: Date,
): string {
  const applied = pipelineEntries(rows, now).filter((entry) => entry.applied);
  if (applied.length === 0) {
    return "Outcomes: no applications recorded yet. Tick Applied and set Stage in Job Pipeline to start tracking.";
  }
  const summarize = (
    label: string,
    key: (entry: PipelineEntry) => string,
  ): string[] => {
    const groups = new Map<string, PipelineEntry[]>();
    for (const entry of applied) {
      const name = key(entry);
      groups.set(name, [...(groups.get(name) ?? []), entry]);
    }
    return [
      `By ${label}:`,
      ...[...groups.entries()]
        .sort((left, right) => right[1].length - left[1].length)
        .map(([name, group]) => {
          const responded = group.filter((entry) =>
            RESPONDED_STAGES.has(entry.stage),
          ).length;
          const positive = group.filter((entry) =>
            POSITIVE_STAGES.has(entry.stage),
          ).length;
          return `- ${name}: ${String(group.length)} applied, ${String(responded)} responses (${rate(responded, group.length)}), ${String(positive)} interviews or offers (${rate(positive, group.length)})`;
        }),
    ];
  };
  const responded = applied.filter((entry) =>
    RESPONDED_STAGES.has(entry.stage),
  ).length;
  const positive = applied.filter((entry) =>
    POSITIVE_STAGES.has(entry.stage),
  ).length;
  return [
    `Outcomes: ${String(applied.length)} applied, ${String(responded)} responses (${rate(responded, applied.length)}), ${String(positive)} interviews or offers (${rate(positive, applied.length)}).`,
    ...(applied.length < 10
      ? ["Fewer than 10 applications: too few to draw conclusions yet."]
      : []),
    ...summarize("verdict", (entry) => entry.verdict || "unreviewed"),
    ...summarize("level", (entry) =>
      entry.flags.includes("Senior title")
        ? "senior title"
        : entry.flags.includes("5+ years") ||
            /Asks \d+\+ years/u.test(entry.flags)
          ? "asks 5+ years"
          : "SDE I/II range",
    ),
    ...summarize("source", (entry) => entry.source),
  ].join("\n");
}
