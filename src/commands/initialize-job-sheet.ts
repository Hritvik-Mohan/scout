import { GoogleAuthAccessTokenProvider } from "../integrations/google-auth.js";
import { GoogleSheetsRestTransport } from "../integrations/google-sheets.js";
import { initializeJobSearchWorkbook } from "../jobs/initialize-workbook.js";
import { requireSearchFile, searchPaths } from "../jobs/search-paths.js";
import { loadScoutProfile } from "../profiles/loader.js";

const spreadsheetId = process.env.SCOUT_JOB_SHEET_ID?.trim();
if (spreadsheetId === undefined || spreadsheetId === "") {
  throw new Error("SCOUT_JOB_SHEET_ID is required");
}
const profile = await loadScoutProfile(
  await requireSearchFile(searchPaths().profile),
);
const transport = new GoogleSheetsRestTransport({
  spreadsheetId,
  tokenProvider: new GoogleAuthAccessTokenProvider(),
});
const result = await initializeJobSearchWorkbook(
  transport,
  spreadsheetId,
  profile,
);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
