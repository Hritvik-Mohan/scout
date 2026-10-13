import { GoogleAuthAccessTokenProvider } from "../integrations/google-auth.js";
import { GoogleSheetsRestTransport } from "../integrations/google-sheets.js";
import { loadOutreachPlan } from "../jobs/outreach-sheet.js";
import { formatOutreachPlan, outreachCapArgument } from "../jobs/outreach.js";

const spreadsheetId = process.env.SCOUT_JOB_SHEET_ID?.trim();
if (spreadsheetId === undefined || spreadsheetId === "") {
  throw new Error("SCOUT_JOB_SHEET_ID is required");
}
const plan = await loadOutreachPlan(
  new GoogleSheetsRestTransport({
    spreadsheetId,
    tokenProvider: new GoogleAuthAccessTokenProvider(),
  }),
  { now: new Date(), cap: outreachCapArgument(process.argv) },
);
process.stdout.write(`${formatOutreachPlan(plan)}\n`);
