import { resolve } from "node:path";

import { GoogleAuthAccessTokenProvider } from "../integrations/google-auth.js";
import {
  createJobSearchWorkbook,
  GoogleJobWorkbookApi,
} from "../jobs/google-workbook.js";
import { loadScoutProfile } from "../profiles/loader.js";

const shareWith = process.env.SCOUT_SHEET_SHARE_EMAIL?.trim();
if (!shareWith?.includes("@")) {
  throw new Error(
    "SCOUT_SHEET_SHARE_EMAIL must contain the Google account that should edit the workbook",
  );
}
const profilePath = resolve(
  process.env.SCOUT_PROFILE_PATH ?? "profiles/jobs.json",
);
const profile = await loadScoutProfile(profilePath);
const api = new GoogleJobWorkbookApi(new GoogleAuthAccessTokenProvider());
const configuredTitle = process.env.SCOUT_JOB_SHEET_TITLE?.trim();
const result = await createJobSearchWorkbook(api, {
  title:
    configuredTitle === undefined || configuredTitle === ""
      ? "Hritvik Job Hunt - Scout"
      : configuredTitle,
  shareWith,
  profile,
});

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
