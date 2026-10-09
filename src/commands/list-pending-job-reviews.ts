import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { GoogleAuthAccessTokenProvider } from "../integrations/google-auth.js";
import { GoogleSheetsRestTransport } from "../integrations/google-sheets.js";
import { JobReviewSheetRepository } from "../jobs/review-sheet.js";
import type { DiscoveredJob } from "../jobs/model.js";

const spreadsheetId = process.env.SCOUT_JOB_SHEET_ID?.trim();
if (spreadsheetId === undefined || spreadsheetId === "") {
  throw new Error("SCOUT_JOB_SHEET_ID is required");
}
const repository = new JobReviewSheetRepository(
  new GoogleSheetsRestTransport({
    spreadsheetId,
    tokenProvider: new GoogleAuthAccessTokenProvider(),
  }),
);
const includeReviewed = process.argv.includes("--all");
const cachePath = resolve(
  process.env.SCOUT_JOB_CACHE_PATH ?? ".local/job-cache.json",
);
const outputPath = resolve(".local/job-reviews/pending.json");
const cache = new Map(
  (JSON.parse(await readFile(cachePath, "utf8")) as DiscoveredJob[]).map(
    (job) => [job.id, job] as const,
  ),
);
const cell = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";
const rows = await repository.pipelineRows();
const missingFromCache: string[] = [];
const pending = rows.flatMap((row, index) => {
  const id = cell(row[0]).trim();
  if (id === "") return [];
  if (!includeReviewed && cell(row[23]).trim() !== "") return [];
  const job = cache.get(id);
  if (job === undefined) {
    missingFromCache.push(id);
    return [];
  }
  return [
    {
      id,
      rowNumber: index + 2,
      title: job.title,
      company: job.company,
      url: job.url,
      location: job.candidateLocation,
      posted: job.publishedAt.slice(0, 10),
      experienceRequired: cell(row[9]),
      flags: cell(row[22]),
      description: job.description.slice(0, 6000),
    },
  ];
});
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(pending, null, 2)}\n`);
process.stdout.write(
  `${JSON.stringify({ pending: pending.length, missingFromCache, outputPath }, null, 2)}\n`,
);
