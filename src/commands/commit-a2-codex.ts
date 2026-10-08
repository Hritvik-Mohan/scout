import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  A2CodexCommitAgent,
  a2CodexResultSchema,
  a2PreparedBatchSchema,
} from "../agents/a2-codex.js";
import { loadConfig } from "../config.js";
import { GoogleAuthAccessTokenProvider } from "../integrations/google-auth.js";
import {
  GoogleSheetsRestTransport,
  GoogleSheetsTrackerRepository,
} from "../integrations/google-sheets.js";
import { executeAgentRun } from "../runtime/run.js";
import { LeadReviewSheet } from "../review/lead-review.js";

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(resolve(path), "utf8")) as unknown;

export async function commitA2FromEnvironment(
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  const config = loadConfig(environment);
  if (!config.DRY_RUN) throw new Error("A2 commit requires DRY_RUN=true");
  const batch = a2PreparedBatchSchema.parse(
    await readJson(".local/a2/prepared.json"),
  );
  const result = a2CodexResultSchema.parse(
    await readJson(".local/a2/result.json"),
  );
  const transport = new GoogleSheetsRestTransport({
    spreadsheetId: config.TRACKER_SHEET_ID,
    tokenProvider: new GoogleAuthAccessTokenProvider(),
  });
  const tracker = new GoogleSheetsTrackerRepository(transport);
  const agent = new A2CodexCommitAgent({ batch, result, tracker });
  const run = await executeAgentRun({
    agent,
    tracker,
    trigger: "codex_interactive",
    dryRun: true,
    identifiers: { runId: randomUUID(), correlationId: batch.batchId },
  });
  if (run.status === "failed" || agent.summary === null)
    throw new Error(run.error ?? "A2 commit failed");
  const leadReview = await new LeadReviewSheet(transport).sync(
    await tracker.listDryRunOutputs(),
  );
  const receipt = resolve(".local/a2/receipt.json");
  await mkdir(dirname(receipt), { recursive: true });
  await writeFile(
    receipt,
    `${JSON.stringify({ run, summary: agent.summary, leadReview }, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(
    `${JSON.stringify({ event: "a2_batch_committed", receipt, summary: agent.summary, leadReview })}\n`,
  );
  return receipt;
}

commitA2FromEnvironment(process.env).catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ event: "a2_commit_failed", message: error instanceof Error ? error.message : "Unknown failure" })}\n`,
  );
  process.exitCode = 1;
});
