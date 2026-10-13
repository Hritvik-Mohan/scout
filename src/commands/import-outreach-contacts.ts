import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { GoogleAuthAccessTokenProvider } from "../integrations/google-auth.js";
import { GoogleSheetsRestTransport } from "../integrations/google-sheets.js";
import { JobOutreachSheetRepository } from "../jobs/outreach-sheet.js";
import {
  outreachRows,
  parseOutreachCsv,
  planOutreachImport,
} from "../jobs/outreach.js";
import { JobReviewSheetRepository } from "../jobs/review-sheet.js";
import { pipelineEntries } from "../jobs/review.js";

const spreadsheetId = process.env.SCOUT_JOB_SHEET_ID?.trim();
if (spreadsheetId === undefined || spreadsheetId === "") {
  throw new Error("SCOUT_JOB_SHEET_ID is required");
}
const file = process.argv[2];
if (file === undefined || file.trim() === "") {
  throw new Error("Usage: npm run jobs:outreach:import -- <contacts.csv>");
}
const { contacts, rejected } = parseOutreachCsv(
  await readFile(resolve(file), "utf8"),
);
const transport = new GoogleSheetsRestTransport({
  spreadsheetId,
  tokenProvider: new GoogleAuthAccessTokenProvider(),
});
const outreach = new JobOutreachSheetRepository(transport);
await outreach.ensureSheet();
const now = new Date();
const result = planOutreachImport(
  contacts,
  outreachRows(await outreach.rows()),
  pipelineEntries(
    await new JobReviewSheetRepository(transport).pipelineRows(),
    now,
  ),
  now.toISOString().slice(0, 10),
);
await outreach.appendContacts(result.rows);
process.stdout.write(
  `${JSON.stringify(
    {
      imported: result.rows.length,
      duplicates: result.duplicates,
      doNotContact: result.doNotContact,
      noReviewedRole: result.unlinked,
      rejected,
    },
    null,
    2,
  )}\n`,
);
if (rejected.length > 0) process.exitCode = 1;
