import { GoogleAuthAccessTokenProvider } from "../integrations/google-auth.js";
import { GoogleSheetsRestTransport } from "../integrations/google-sheets.js";
import { JobReviewSheetRepository } from "../jobs/review-sheet.js";
import { buildJobDigest } from "../jobs/review.js";

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
process.stdout.write(
  `${buildJobDigest(await repository.pipelineRows(), { now: new Date() })}\n`,
);
