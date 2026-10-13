import { GoogleAuthAccessTokenProvider } from "../integrations/google-auth.js";
import { GoogleSheetsRestTransport } from "../integrations/google-sheets.js";
import { JobOutreachSheetRepository } from "../jobs/outreach-sheet.js";
import {
  buildOutreachPlan,
  DEFAULT_OUTREACH_DAILY_CAP,
  formatOutreachPlan,
} from "../jobs/outreach.js";
import { JobReviewSheetRepository } from "../jobs/review-sheet.js";
import { pipelineEntries } from "../jobs/review.js";

const spreadsheetId = process.env.SCOUT_JOB_SHEET_ID?.trim();
if (spreadsheetId === undefined || spreadsheetId === "") {
  throw new Error("SCOUT_JOB_SHEET_ID is required");
}
const capArgument = process.argv
  .find((argument) => argument.startsWith("--cap="))
  ?.slice("--cap=".length);
const cap =
  capArgument === undefined ? DEFAULT_OUTREACH_DAILY_CAP : Number(capArgument);
if (!Number.isInteger(cap) || cap < 0) {
  throw new Error("--cap must be a whole number, 0 or more");
}
const transport = new GoogleSheetsRestTransport({
  spreadsheetId,
  tokenProvider: new GoogleAuthAccessTokenProvider(),
});
const outreach = new JobOutreachSheetRepository(transport);
await outreach.ensureSheet();
const now = new Date();
// Contacted On holds a calendar date, so "today" is the local date.
const today = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, "0"),
  String(now.getDate()).padStart(2, "0"),
].join("-");
process.stdout.write(
  `${formatOutreachPlan(
    buildOutreachPlan(
      await outreach.rows(),
      pipelineEntries(
        await new JobReviewSheetRepository(transport).pipelineRows(),
        now,
      ),
      { today, cap },
    ),
  )}\n`,
);
