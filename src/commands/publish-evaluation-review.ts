import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadConfig } from "../config.js";
import { EvaluationReviewSheet } from "../evaluation/workflow.js";
import { GoogleAuthAccessTokenProvider } from "../integrations/google-auth.js";
import { GoogleSheetsRestTransport } from "../integrations/google-sheets.js";

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(resolve(path), "utf8")) as unknown;

export async function publishEvaluationReviewFromEnvironment(
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const config = loadConfig(environment);
  if (!config.DRY_RUN)
    throw new Error("Evaluation publishing requires DRY_RUN=true");
  const evaluationDirectory = ".local/evaluations/2026-10-07";
  const transport = new GoogleSheetsRestTransport({
    spreadsheetId: config.TRACKER_SHEET_ID,
    tokenProvider: new GoogleAuthAccessTokenProvider(),
  });
  const result = await new EvaluationReviewSheet(transport).publish(
    await readJson(`${evaluationDirectory}/frozen-input.json`),
    await readJson(`${evaluationDirectory}/a1-result.json`),
  );
  process.stdout.write(
    `${JSON.stringify({ event: "evaluation_review_published", ...result })}\n`,
  );
}

publishEvaluationReviewFromEnvironment(process.env).catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ event: "evaluation_review_publish_failed", message: error instanceof Error ? error.message : "Unknown failure" })}\n`,
  );
  process.exitCode = 1;
});
