import { loadConfig } from "../config.js";
import { GoogleAuthAccessTokenProvider } from "../integrations/google-auth.js";
import {
  GoogleSheetsRestTransport,
  GoogleSheetsTrackerRepository,
} from "../integrations/google-sheets.js";
import {
  LeadReviewSheet,
  type LeadReviewSyncResult,
} from "../review/lead-review.js";

export async function syncLeadReviewFromEnvironment(
  environment: NodeJS.ProcessEnv,
): Promise<LeadReviewSyncResult> {
  const config = loadConfig(environment);
  const transport = new GoogleSheetsRestTransport({
    spreadsheetId: config.TRACKER_SHEET_ID,
    tokenProvider: new GoogleAuthAccessTokenProvider(),
  });
  const tracker = new GoogleSheetsTrackerRepository(transport);
  const result = await new LeadReviewSheet(transport).sync(
    await tracker.listDryRunOutputs(),
  );
  process.stdout.write(
    `${JSON.stringify({ event: "lead_review_synced", ...result })}\n`,
  );
  return result;
}

const isDirectRun = process.argv[1]?.endsWith("sync-lead-review.js") ?? false;
if (isDirectRun) {
  syncLeadReviewFromEnvironment(process.env).catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({ event: "lead_review_sync_failed", message: error instanceof Error ? error.message : "Unknown failure" })}\n`,
    );
    process.exitCode = 1;
  });
}
