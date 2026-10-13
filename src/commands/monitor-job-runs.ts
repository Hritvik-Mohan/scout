import { GoogleAuthAccessTokenProvider } from "../integrations/google-auth.js";
import { GitHubIssues } from "../integrations/github-issues.js";
import { GoogleSheetsRestTransport } from "../integrations/google-sheets.js";
import {
  evaluateRunHealth,
  issueMarker,
  planIssues,
} from "../jobs/run-monitor.js";

const hours = (value: string | undefined, fallback: number): number => {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Monitor windows must be positive numbers of hours");
  }
  return parsed;
};

const spreadsheetId = process.env.SCOUT_JOB_SHEET_ID?.trim();
if (spreadsheetId === undefined || spreadsheetId === "") {
  throw new Error("SCOUT_JOB_SHEET_ID is required");
}
const transport = new GoogleSheetsRestTransport({
  spreadsheetId,
  tokenProvider: new GoogleAuthAccessTokenProvider(),
});
const now = new Date();
const findings = evaluateRunHealth(
  await transport.getValues("'Runs'!A2:H1000"),
  await transport.getValues("'Sources'!A2:H1000"),
  {
    now,
    maxSilenceHours: hours(process.env.SCOUT_MONITOR_MAX_SILENCE_HOURS, 16),
    sourceStaleHours: hours(process.env.SCOUT_MONITOR_SOURCE_STALE_HOURS, 48),
  },
);

const repository = process.env.SCOUT_ISSUE_REPO?.trim() ?? "";
const token = process.env.GITHUB_TOKEN?.trim() ?? "";
const created: string[] = [];
let closed = 0;
let existing = 0;
if (repository !== "" && token !== "") {
  const issues = new GitHubIssues({ repository, token });
  const plan = planIssues(findings, await issues.listOpen());
  existing = plan.existing.length;
  for (const finding of plan.create) {
    created.push(
      await issues.create(
        finding.title,
        `${finding.body}\n\n_Opened by the Scout run monitor on ${now.toISOString().slice(0, 10)}. It closes itself when the problem clears._\n\n${issueMarker(finding.key)}`,
      ),
    );
  }
  for (const number of plan.close) {
    await issues.close(
      number,
      `Resolved: the run monitor no longer sees this problem (${now.toISOString()}).`,
    );
    closed += 1;
  }
}
process.stdout.write(
  `${JSON.stringify({ healthy: findings.length === 0, findings: findings.map((finding) => finding.title), issues: repository !== "" && token !== "" ? { created, alreadyOpen: existing, closed } : "not configured: set SCOUT_ISSUE_REPO and GITHUB_TOKEN to file issues" }, null, 2)}\n`,
);
if (findings.length > 0) process.exitCode = 1;
