import type { DiscoveredJob } from "./model.js";

/**
 * Review flags for kept roles that differ from the core SDE I/II target. They
 * inform the human review and never change the score or status.
 */
export function jobFlags(
  job: DiscoveredJob,
  experienceRequired: string,
): readonly string[] {
  const title = job.title.toLowerCase();
  const flags: string[] = [];
  if (/\b(?:senior|sr)\b/u.test(title)) {
    flags.push("Senior title - above SDE I/II target");
  }
  if (/\bintern(?:ship)?\b/u.test(title)) flags.push("Internship");
  if (
    /\b(?:data engineer|analytics engineer|machine learning|ml engineer)\b/u.test(
      title,
    )
  ) {
    flags.push("Data/ML-focused role");
  }
  const years = Math.max(
    0,
    ...[...experienceRequired.matchAll(/(\d+)\+/gu)].map((match) =>
      Number(match[1]),
    ),
  );
  if (years >= 5) flags.push(`Asks ${String(years)}+ years - stretch`);
  return flags;
}
