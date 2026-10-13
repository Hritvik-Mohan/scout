import { GoogleAuthAccessTokenProvider } from "../integrations/google-auth.js";
import { GoogleSheetsRestTransport } from "../integrations/google-sheets.js";
import { JobOutreachSheetRepository } from "../jobs/outreach-sheet.js";
import { buildOutreachFollowUps, localDay } from "../jobs/outreach.js";
import { JobReviewSheetRepository } from "../jobs/review-sheet.js";
import { buildJobDigest, buildOutcomeReport } from "../jobs/review.js";

const spreadsheetId = process.env.SCOUT_JOB_SHEET_ID?.trim();
if (spreadsheetId === undefined || spreadsheetId === "") {
  throw new Error("SCOUT_JOB_SHEET_ID is required");
}
const transport = new GoogleSheetsRestTransport({
  spreadsheetId,
  tokenProvider: new GoogleAuthAccessTokenProvider(),
});
const rows = await new JobReviewSheetRepository(transport).pipelineRows();
const now = new Date();
const outreachFollowUps = buildOutreachFollowUps(
  await new JobOutreachSheetRepository(transport).rowsIfPresent(),
  { today: localDay(now) },
);
process.stdout.write(
  `${[
    buildJobDigest(rows, { now }),
    outreachFollowUps,
    buildOutcomeReport(rows, now),
  ]
    .filter(Boolean)
    .join("\n\n")}\n`,
);
