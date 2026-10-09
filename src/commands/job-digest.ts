import { GoogleAuthAccessTokenProvider } from "../integrations/google-auth.js";
import { GoogleSheetsRestTransport } from "../integrations/google-sheets.js";
import { JobReviewSheetRepository } from "../jobs/review-sheet.js";
import { buildJobDigest, buildOutcomeReport } from "../jobs/review.js";

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
const rows = await repository.pipelineRows();
const now = new Date();
process.stdout.write(
  `${buildJobDigest(rows, { now })}\n\n${buildOutcomeReport(rows, now)}\n`,
);
