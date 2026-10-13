import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { GoogleAuthAccessTokenProvider } from "../integrations/google-auth.js";
import {
  GoogleSheetsRestTransport,
  type SheetValueUpdate,
} from "../integrations/google-sheets.js";
import { assessJob } from "../jobs/assess.js";
import type { DiscoveredJob } from "../jobs/model.js";
import {
  JobPipelineSheetRepository,
  type JobPipelineWrite,
} from "../jobs/pipeline-sheet.js";
import {
  completeFeedIdPrefix,
  createJobDiscoveryAdapter,
  parseConfiguredJobSources,
} from "../jobs/sources.js";
import { JobReviewSheetRepository } from "../jobs/review-sheet.js";
import { readSearchRepoState, searchRepoWarning } from "../jobs/search-repo.js";
import { loadJobSearchConfig } from "../jobs/search-config.js";
import { requireSearchFile, searchPaths } from "../jobs/search-paths.js";
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
  await requireSearchFile(searchPaths().profile),
);
const search = await loadJobSearchConfig(
  await requireSearchFile(searchPaths().search),
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
const sourceRows = await transport.getValues("'Sources'!A2:H1000");
const sources = parseConfiguredJobSources(sourceRows);
if (sources.length === 0) {
  throw new Error(
    "No active Remotive, Greenhouse, Lever, SmartRecruiters, or Ashby sources are configured in Sources!A2:H1000",
  );
}
const discoveryResults = await Promise.allSettled(
  sources.map(async (source) => ({
    source,
    jobs: await createJobDiscoveryAdapter(source, fetch, search).discover(
      request,
    ),
  })),
);
const failures: string[] = [];
const discoveredJobs: DiscoveredJob[] = [];
const checkedAt = new Date().toISOString();
const checkedUpdates: SheetValueUpdate[] = [];
// Sources whose feed came back whole, so a missing role means it has closed.
const completePrefixes: string[] = [];
for (const [index, result] of discoveryResults.entries()) {
  const source = sources[index];
  if (source === undefined) continue;
  if (result.status === "fulfilled") {
    discoveredJobs.push(...result.value.jobs);
    const prefix = completeFeedIdPrefix(source);
    if (prefix !== null && result.value.jobs.length < maxResults) {
      completePrefixes.push(prefix);
    }
    checkedUpdates.push({
      range: `'Sources'!G${String(source.rowNumber)}:G${String(source.rowNumber)}`,
      values: [[checkedAt]],
    });
  } else {
    const message =
      result.reason instanceof Error
        ? result.reason.message
        : String(result.reason);
    failures.push(`${source.id}: ${message}`);
  }
}
if (checkedUpdates.length > 0)
  await transport.batchUpdateValues(checkedUpdates);
const uniqueJobs = new Map<string, DiscoveredJob>();
for (const job of discoveredJobs) uniqueJobs.set(job.id, job);
const jobs = [...uniqueJobs.values()];
const keptJobs: DiscoveredJob[] = [];
const writes: JobPipelineWrite[] = [];
const rejectedIds: string[] = [];
let action = 0;
for (const job of jobs) {
  const assessed = assessJob(job, search);
  const score = scoreOpportunity(profile, assessed.assessment);
  if (score.status !== "keep" && score.status !== "action") {
    rejectedIds.push(job.id);
    continue;
  }
  keptJobs.push(job);
  if (score.status === "action") action += 1;
  writes.push({ job, assessed, score });
}
const kept = writes.length;
const pruned = await repository.removeManyIfUntracked(rejectedIds);
const missing = await repository.reconcileMissing(
  completePrefixes,
  new Set(jobs.map((job) => job.id)),
  startedAt,
);
await new JobReviewSheetRepository(transport).removeDrafts(missing.removed);
const { inserted, updated } = await repository.upsertMany(writes, startedAt);
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
  `${JSON.stringify({ runId, status, sources: sources.length, sourceFailures: failures, discovered: jobs.length, kept, action, inserted, updated, pruned, notOnBoard: missing.flagged, closed: missing.closed, removedClosed: missing.removed.length, finishedAt: finishedAt.toISOString() }, null, 2)}\n`,
);
const searchWarning = searchRepoWarning(readSearchRepoState());
if (searchWarning !== null) process.stderr.write(`Warning: ${searchWarning}\n`);
if (status === "failed") process.exitCode = 1;
