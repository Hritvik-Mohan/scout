/**
 * Health checks over the sheet's Runs and Sources tabs, and the GitHub issues
 * that should exist for them. Everything here is pure so the watchdog can run
 * anywhere, including outside the machine that performs the refresh.
 */

export interface RunHealthFinding {
  /** Stable identity, so one problem maps to one issue. */
  key: string;
  title: string;
  body: string;
}

export interface RunHealthOptions {
  now: Date;
  /** Hours without any run before the refresh is reported as not running. */
  maxSilenceHours?: number;
  /** Hours a source may go unchecked before it is reported as failing. */
  sourceStaleHours?: number;
}

const POLLED_TYPES = new Set([
  "remotive",
  "greenhouse",
  "lever",
  "smartrecruiters",
  "ashby",
]);

const text = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

const isActive = (value: unknown): boolean =>
  value === true || ["true", "yes", "1"].includes(text(value).toLowerCase());

const hoursBetween = (later: Date, earlier: number): number =>
  (later.valueOf() - earlier) / 3_600_000;

const describe = (hours: number): string =>
  hours >= 48
    ? `${String(Math.floor(hours / 24))} days`
    : `${String(Math.floor(hours))} hours`;

/**
 * Evaluates the Runs tab (A2:H) and Sources tab (A2:H). A single partial run
 * is not a finding: feeds time out now and then. A source is reported only
 * once it has gone unchecked for longer than the stale window.
 */
export function evaluateRunHealth(
  runRows: readonly (readonly unknown[])[],
  sourceRows: readonly (readonly unknown[])[],
  options: RunHealthOptions,
): readonly RunHealthFinding[] {
  const maxSilenceHours = options.maxSilenceHours ?? 16;
  const sourceStaleHours = options.sourceStaleHours ?? 48;
  const findings: RunHealthFinding[] = [];
  const runs = runRows
    .map((row) => ({
      started: Date.parse(text(row[1])),
      status: text(row[3]),
      error: text(row[7]),
    }))
    .filter((run) => !Number.isNaN(run.started))
    .sort((left, right) => right.started - left.started);
  const latest = runs[0];

  if (
    latest === undefined ||
    hoursBetween(options.now, latest.started) > maxSilenceHours
  ) {
    const since =
      latest === undefined
        ? "No run has ever been recorded."
        : `The last recorded run started ${describe(hoursBetween(options.now, latest.started))} ago (${new Date(latest.started).toISOString()}).`;
    findings.push({
      key: "no-recent-run",
      title: "Scout refresh is not running",
      body: [
        since,
        `The refresh is expected at least every ${String(maxSilenceHours)} hours.`,
        "",
        "Things to check:",
        "- Is the scheduled task or cloud routine still enabled?",
        "- Did its last run stop before `npm run jobs:update`? A usage limit, a missing environment variable, or a repository that could not be cloned all end a run before anything is recorded.",
        "- Open the routine's most recent run and read its final message.",
      ].join("\n"),
    });
    // With no fresh run, source timestamps are stale for the same reason.
    return findings;
  }

  if (latest.status === "failed") {
    findings.push({
      key: "run-failed",
      title: "Scout refresh failed: every source errored",
      body: [
        `The run that started at ${new Date(latest.started).toISOString()} reached none of its sources.`,
        "",
        "Recorded error:",
        "```",
        latest.error === "" ? "(none recorded)" : latest.error,
        "```",
        "",
        "When every source fails at once, the cause is usually network access from where the refresh runs, not the job boards.",
      ].join("\n"),
    });
  }

  for (const row of sourceRows) {
    const id = text(row[0]).trim();
    const type = text(row[2]).trim().toLowerCase();
    if (id === "" || !POLLED_TYPES.has(type) || !isActive(row[5])) continue;
    const checked = Date.parse(text(row[6]));
    const stale = Number.isNaN(checked)
      ? null
      : hoursBetween(options.now, checked);
    if (stale !== null && stale <= sourceStaleHours) continue;
    const lastError =
      runs
        .flatMap((run) => run.error.split(" | "))
        .find((entry) => entry.startsWith(`${id}:`)) ?? "";
    findings.push({
      key: `source-failing:${id}`,
      title: `Scout source is failing: ${id}`,
      body: [
        stale === null
          ? `The source \`${id}\` (${type}) has never been checked successfully.`
          : `The source \`${id}\` (${type}) was last checked successfully ${describe(stale)} ago.`,
        `Feed: ${text(row[3])}`,
        "",
        lastError === ""
          ? "No error was recorded for it in recent runs."
          : `Most recent error:\n\`\`\`\n${lastError}\n\`\`\``,
        "",
        "Things to check:",
        "- Open the feed URL. A 404 usually means the company moved to a different job board.",
        "- A schema error means the feed's format changed and the adapter needs an update.",
        "- To stop polling it, untick Active on its row in the Sources tab.",
      ].join("\n"),
    });
  }
  return findings;
}

const MARKER = /<!-- scout-monitor:(.+?) -->/u;

export const issueMarker = (key: string): string =>
  `<!-- scout-monitor:${key} -->`;

/** The finding key recorded in an issue body, or null for unrelated issues. */
export const issueKey = (body: string): string | null =>
  MARKER.exec(body)?.[1] ?? null;

export interface OpenIssue {
  number: number;
  body: string;
}

export interface IssuePlan {
  create: readonly RunHealthFinding[];
  /** Issues whose problem has gone away. */
  close: readonly number[];
  /** Findings that already have an open issue. */
  existing: readonly string[];
}

/** One open issue per finding: create the missing, close the resolved. */
export function planIssues(
  findings: readonly RunHealthFinding[],
  openIssues: readonly OpenIssue[],
): IssuePlan {
  const tracked = new Map<string, number>();
  for (const issue of openIssues) {
    const key = issueKey(issue.body);
    if (key !== null && !tracked.has(key)) tracked.set(key, issue.number);
  }
  const current = new Set(findings.map((finding) => finding.key));
  return {
    create: findings.filter((finding) => !tracked.has(finding.key)),
    close: [...tracked.entries()]
      .filter(([key]) => !current.has(key))
      .map(([, number]) => number),
    existing: findings
      .filter((finding) => tracked.has(finding.key))
      .map((finding) => finding.key),
  };
}
