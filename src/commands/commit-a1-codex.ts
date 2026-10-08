import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  A1CodexCommitAgent,
  a1CodexResultSchema,
  a1PreparedBatchSchema,
} from "../agents/a1-codex.js";
import { loadConfig } from "../config.js";
import { GoogleAuthAccessTokenProvider } from "../integrations/google-auth.js";
import {
  GoogleSheetsRestTransport,
  GoogleSheetsTrackerRepository,
} from "../integrations/google-sheets.js";
import { executeAgentRun } from "../runtime/run.js";

interface Arguments {
  batch: string;
  result: string;
  receipt: string;
}

const parseArguments = (arguments_: readonly string[]): Arguments => {
  let batch = ".local/a1/prepared.json";
  let result = ".local/a1/result.json";
  let receipt = ".local/a1/receipt.json";
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (argument === "--batch" && value !== undefined) batch = value;
    else if (argument === "--result" && value !== undefined) result = value;
    else if (argument === "--receipt" && value !== undefined) receipt = value;
    else throw new Error(`Unknown or incomplete argument: ${argument ?? ""}`);
    index += 1;
  }
  return { batch, result, receipt };
};

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(resolve(path), "utf8")) as unknown;

export async function commitA1FromEnvironment(
  environment: NodeJS.ProcessEnv,
  arguments_: readonly string[],
): Promise<string> {
  const config = loadConfig(environment);
  if (!config.DRY_RUN) throw new Error("A1 commit requires DRY_RUN=true");
  const args = parseArguments(arguments_);
  const batch = a1PreparedBatchSchema.parse(await readJson(args.batch));
  const result = a1CodexResultSchema.parse(await readJson(args.result));
  const tracker = new GoogleSheetsTrackerRepository(
    new GoogleSheetsRestTransport({
      spreadsheetId: config.TRACKER_SHEET_ID,
      tokenProvider: new GoogleAuthAccessTokenProvider(),
    }),
  );
  const agent = new A1CodexCommitAgent({
    batch,
    result,
    tracker,
    dailyCap: config.MAX_NEW_LEADS_PER_DAY,
  });
  const run = await executeAgentRun({
    agent,
    tracker,
    trigger: "codex_interactive",
    dryRun: true,
    identifiers: { runId: randomUUID(), correlationId: batch.batchId },
  });
  if (run.status === "failed" || agent.summary === null) {
    throw new Error(run.error ?? "A1 commit failed");
  }
  const receipt = resolve(args.receipt);
  await mkdir(dirname(receipt), { recursive: true });
  await writeFile(
    receipt,
    `${JSON.stringify({ run, summary: agent.summary }, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(
    `${JSON.stringify({ event: "a1_batch_committed", receipt, summary: agent.summary })}\n`,
  );
  return receipt;
}

commitA1FromEnvironment(process.env, process.argv.slice(2)).catch(
  (error: unknown) => {
    const name = error instanceof Error ? error.name : "UnknownError";
    const message = error instanceof Error ? error.message : "Unknown failure";
    process.stderr.write(
      `${JSON.stringify({ event: "a1_commit_failed", name, message })}\n`,
    );
    process.exitCode = 1;
  },
);
