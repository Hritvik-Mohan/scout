import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { GoogleAuthAccessTokenProvider } from "../integrations/google-auth.js";
import { GoogleSheetsRestTransport } from "../integrations/google-sheets.js";
import { JobReviewSheetRepository } from "../jobs/review-sheet.js";
import { jobReviewFileSchema } from "../jobs/review.js";

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
const file = process.argv[2];
if (file === undefined || file.trim() === "") {
  throw new Error("Usage: npm run jobs:review:apply -- <reviews.json>");
}
const reviews = jobReviewFileSchema.parse(
  JSON.parse(await readFile(resolve(file), "utf8")) as unknown,
);
const result = await repository.applyReviews(reviews, new Date().toISOString());
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.unknownIds.length > 0) process.exitCode = 1;
