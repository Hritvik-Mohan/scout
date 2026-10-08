import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { prepareA2CodexBatch } from "../agents/a2-codex.js";
import { loadConfig } from "../config.js";
import { GoogleAuthAccessTokenProvider } from "../integrations/google-auth.js";
import {
  GoogleSheetsRestTransport,
  GoogleSheetsTrackerRepository,
} from "../integrations/google-sheets.js";

export async function prepareA2FromEnvironment(
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  const config = loadConfig(environment);
  if (!config.DRY_RUN) throw new Error("A2 preparation requires DRY_RUN=true");
  const tracker = new GoogleSheetsTrackerRepository(
    new GoogleSheetsRestTransport({
      spreadsheetId: config.TRACKER_SHEET_ID,
      tokenProvider: new GoogleAuthAccessTokenProvider(),
    }),
  );
  const batch = prepareA2CodexBatch(
    await tracker.listDryRunOutputs(),
    randomUUID(),
    new Date().toISOString(),
    config.RESEARCH_BATCH_SIZE,
  );
  const output = resolve(".local/a2/prepared.json");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(batch, null, 2)}\n`, "utf8");
  process.stdout.write(
    `${JSON.stringify({ event: "a2_batch_prepared", output, leads: batch.leads.length })}\n`,
  );
  return output;
}

prepareA2FromEnvironment(process.env).catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ event: "a2_prepare_failed", message: error instanceof Error ? error.message : "Unknown failure" })}\n`,
  );
  process.exitCode = 1;
});
