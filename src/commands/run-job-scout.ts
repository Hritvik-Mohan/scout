import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { GoogleAuthAccessTokenProvider } from "../integrations/google-auth.js";
import { GoogleSheetsRestTransport } from "../integrations/google-sheets.js";
import { assessJob } from "../jobs/assess.js";
import type { DiscoveredJob } from "../jobs/model.js";
import { JobPipelineSheetRepository } from "../jobs/pipeline-sheet.js";
import {
  createJobDiscoveryAdapter,
  parseConfiguredJobSources,
} from "../jobs/sources.js";
import { loadScoutProfile } from "../profiles/loader.js";
import { scoreOpportunity } from "../profiles/scorer.js";

const positiveInteger = (
  value: string | undefined,
  fallback: number,
): number => {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("Job Scout limits must be positive integers");
  }
  return parsed;
};

const spreadsheetId = process.env.SCOUT_JOB_SHEET_ID?.trim();
if (spreadsheetId === undefined || spreadsheetId === "") {
  throw new Error("SCOUT_JOB_SHEET_ID is required");
}
const profile = await loadScoutProfile(
  resolve(process.env.SCOUT_PROFILE_PATH ?? "profiles/jobs.json"),
);
const maxResults = positiveInteger(process.env.SCOUT_JOB_MAX_RESULTS, 100);
const lookbackHours = positiveInteger(
  process.env.SCOUT_JOB_LOOKBACK_HOURS,
  336,
);
const startedAt = new Date();
const runId = randomUUID();
const transport = new GoogleSheetsRestTransport({
  spreadsheetId,
  tokenProvider: new GoogleAuthAccessTokenProvider(),
});
const repository = new JobPipelineSheetRepository(transport);
const request = {
  startAt: new Date(startedAt.valueOf() - lookbackHours * 60 * 60 * 1000),
  endAt: startedAt,
  maxResults,
};
const sourceRows = await transport.getValues("'Sources'!A2:H200");
const sources = parseConfiguredJobSources(sourceRows);
if (sources.length === 0) {
  throw new Error(
    "No active Remotive, Greenhouse, Lever, SmartRecruiters, or Ashby sources are configured in Sources!A2:H200",
  );
}
const discoveryResults = await Promise.allSettled(
  sources.map(async (source) => ({
    source,
    jobs: await createJobDiscoveryAdapter(source).discover(request),
  })),
);
const failures: string[] = [];
const discoveredJobs: DiscoveredJob[] = [];
const checkedAt = new Date().toISOString();
for (const [index, result] of discoveryResults.entries()) {
  const source = sources[index];
  if (source === undefined) continue;
  if (result.status === "fulfilled") {
    discoveredJobs.push(...result.value.jobs);
    await transport.batchUpdateValues([
      {
        range: `'Sources'!G${String(source.rowNumber)}:G${String(source.rowNumber)}`,
        values: [[checkedAt]],
      },
    ]);
  } else {
    const message =
      result.reason instanceof Error
        ? result.reason.message
        : String(result.reason);
    failures.push(`${source.id}: ${message}`);
  }
}
const uniqueJobs = new Map<string, DiscoveredJob>();
for (const job of discoveredJobs) uniqueJobs.set(job.id, job);
const jobs = [...uniqueJobs.values()];
const keptJobs: DiscoveredJob[] = [];
let kept = 0;
let action = 0;
let inserted = 0;
let updated = 0;
let pruned = 0;
for (const job of jobs) {
  const assessed = assessJob(job);
  const score = scoreOpportunity(profile, assessed.assessment);
  if (score.status !== "keep" && score.status !== "action") {
    if (await repository.removeIfUntracked(job.id)) pruned += 1;
    continue;
  }
  kept += 1;
  keptJobs.push(job);
  if (score.status === "action") action += 1;
  const outcome = await repository.upsert({ job, assessed, score });
  if (outcome === "inserted") inserted += 1;
  else updated += 1;
}
// Kept postings are cached locally so the review step can read full
// descriptions without polling every source again.
const cachePath = resolve(
  process.env.SCOUT_JOB_CACHE_PATH ?? ".local/job-cache.json",
);
await mkdir(dirname(cachePath), { recursive: true });
await writeFile(cachePath, `${JSON.stringify(keptJobs)}\n`);
const finishedAt = new Date();
const status =
  failures.length === 0
    ? "success"
    : failures.length === sources.length
      ? "failed"
      : "partial";
await repository.appendRun({
  runId,
  started: startedAt.toISOString(),
  finished: finishedAt.toISOString(),
  status,
  opportunitiesFound: jobs.length,
  kept,
  action,
  error: failures.length === 0 ? null : failures.join(" | "),
});
process.stdout.write(
  `${JSON.stringify({ runId, status, sources: sources.length, sourceFailures: failures, discovered: jobs.length, kept, action, inserted, updated, pruned, finishedAt: finishedAt.toISOString() }, null, 2)}\n`,
);
if (status === "failed") process.exitCode = 1;
