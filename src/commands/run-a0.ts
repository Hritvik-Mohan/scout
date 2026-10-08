import { A0NoOpAgent } from "../agents/a0.js";
import { loadConfig } from "../config.js";
import { GoogleAuthAccessTokenProvider } from "../integrations/google-auth.js";
import {
  GoogleSheetsRestTransport,
  GoogleSheetsTrackerRepository,
} from "../integrations/google-sheets.js";
import { executeAgentRun } from "../runtime/run.js";

export async function runA0(environment: NodeJS.ProcessEnv): Promise<void> {
  const config = loadConfig(environment);
  if (!config.DRY_RUN) {
    throw new Error("The Phase 0 A0 release job requires DRY_RUN=true");
  }

  const transport = new GoogleSheetsRestTransport({
    spreadsheetId: config.TRACKER_SHEET_ID,
    tokenProvider: new GoogleAuthAccessTokenProvider(),
  });
  const tracker = new GoogleSheetsTrackerRepository(transport);
  const agent = new A0NoOpAgent(async () => {
    await tracker.discoverPipelineHeaders();
    return { ready: true };
  });
  const configuredTrigger = environment.RUN_TRIGGER?.trim();

  await executeAgentRun({
    agent,
    tracker,
    trigger:
      configuredTrigger === undefined || configuredTrigger === ""
        ? "cloud_scheduler"
        : configuredTrigger,
    dryRun: true,
  });
}

runA0(process.env).catch((error: unknown) => {
  const name = error instanceof Error ? error.name : "UnknownError";
  const message = error instanceof Error ? error.message : "Unknown failure";
  process.stderr.write(
    `${JSON.stringify({ event: "a0_job_failed", name, message })}\n`,
  );
  process.exitCode = 1;
});
