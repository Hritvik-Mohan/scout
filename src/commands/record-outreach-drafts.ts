import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { GoogleAuthAccessTokenProvider } from "../integrations/google-auth.js";
import { GoogleSheetsRestTransport } from "../integrations/google-sheets.js";
import { JobOutreachSheetRepository } from "../jobs/outreach-sheet.js";
import { createdOutreachDraftsSchema, localDay } from "../jobs/outreach.js";

const spreadsheetId = process.env.SCOUT_JOB_SHEET_ID?.trim();
if (spreadsheetId === undefined || spreadsheetId === "") {
  throw new Error("SCOUT_JOB_SHEET_ID is required");
}
const file = process.argv[2];
if (file === undefined || file.trim() === "") {
  throw new Error(
    "Usage: npm run jobs:outreach:drafts:record -- <created.json>",
  );
}
const created = createdOutreachDraftsSchema.parse(
  JSON.parse(await readFile(resolve(file), "utf8")) as unknown,
);
const result = await new JobOutreachSheetRepository(
  new GoogleSheetsRestTransport({
    spreadsheetId,
    tokenProvider: new GoogleAuthAccessTokenProvider(),
  }),
).recordDrafts(created, localDay(new Date()));
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.mismatched.length > 0) process.exitCode = 1;
