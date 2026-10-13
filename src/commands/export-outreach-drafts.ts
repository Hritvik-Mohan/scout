import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { GoogleAuthAccessTokenProvider } from "../integrations/google-auth.js";
import { GoogleSheetsRestTransport } from "../integrations/google-sheets.js";
import { loadOutreachPlan } from "../jobs/outreach-sheet.js";
import {
  buildOutreachDrafts,
  outreachLimitArguments,
} from "../jobs/outreach.js";
import { JobReviewSheetRepository } from "../jobs/review-sheet.js";

const spreadsheetId = process.env.SCOUT_JOB_SHEET_ID?.trim();
if (spreadsheetId === undefined || spreadsheetId === "") {
  throw new Error("SCOUT_JOB_SHEET_ID is required");
}
const transport = new GoogleSheetsRestTransport({
  spreadsheetId,
  tokenProvider: new GoogleAuthAccessTokenProvider(),
});
const plan = await loadOutreachPlan(transport, {
  now: new Date(),
  ...outreachLimitArguments(process.argv),
});
const result = buildOutreachDrafts(
  plan,
  await new JobReviewSheetRepository(transport).kitRows(),
);
const outputPath = resolve(".local/outreach/drafts.json");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result.drafts, null, 2)}\n`);
process.stdout.write(
  `${JSON.stringify(
    {
      drafts: result.drafts.length,
      alreadyDrafted: result.alreadyDrafted,
      noOutreachDraftForRole: result.missing.map(({ row, role }) => ({
        rowNumber: row.rowNumber,
        company: row.company,
        opportunityId: role.id,
      })),
      outputPath,
    },
    null,
    2,
  )}\n`,
);
