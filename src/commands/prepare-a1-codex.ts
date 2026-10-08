import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { prepareA1CodexBatch } from "../agents/a1-codex.js";
import { loadConfig } from "../config.js";
import { GdeltDiscoveryAdapter } from "../discovery/gdelt.js";
import { RssDiscoveryAdapter } from "../discovery/rss.js";
import { GoogleAuthAccessTokenProvider } from "../integrations/google-auth.js";
import {
  GoogleSheetsRestTransport,
  GoogleSheetsTrackerRepository,
} from "../integrations/google-sheets.js";

interface Arguments {
  output: string;
  hours: number;
  maxDocuments: number | null;
}

const parsePositiveInteger = (value: string, name: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
};

const parseArguments = (arguments_: readonly string[]): Arguments => {
  let output = ".local/a1/prepared.json";
  let hours = 48;
  let maxDocuments: number | null = null;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (argument === "--output" && value !== undefined) {
      output = value;
      index += 1;
    } else if (argument === "--hours" && value !== undefined) {
      hours = parsePositiveInteger(value, "hours");
      index += 1;
    } else if (argument === "--max-documents" && value !== undefined) {
      maxDocuments = parsePositiveInteger(value, "max-documents");
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument ?? ""}`);
    }
  }
  return { output, hours, maxDocuments };
};

export async function prepareA1FromEnvironment(
  environment: NodeJS.ProcessEnv,
  arguments_: readonly string[],
): Promise<string> {
  const config = loadConfig(environment);
  if (!config.DRY_RUN) throw new Error("A1 preparation requires DRY_RUN=true");
  if (config.SEARCH_PROVIDER !== "gdelt") {
    throw new Error(
      "A1 discovery is disabled; set SEARCH_PROVIDER=gdelt after approving Sources query egress",
    );
  }
  const args = parseArguments(arguments_);
  const tracker = new GoogleSheetsTrackerRepository(
    new GoogleSheetsRestTransport({
      spreadsheetId: config.TRACKER_SHEET_ID,
      tokenProvider: new GoogleAuthAccessTokenProvider(),
    }),
  );
  const sources = await tracker.listSources();
  if (!sources.some((source) => source.active)) {
    throw new Error("The Sources tab has no active rows");
  }
  const endAt = new Date();
  const startAt = new Date(endAt.valueOf() - args.hours * 60 * 60 * 1000);
  const batch = await prepareA1CodexBatch({
    batchId: randomUUID(),
    sources,
    adapters: [new GdeltDiscoveryAdapter(), new RssDiscoveryAdapter()],
    startAt,
    endAt,
    maxDocuments:
      args.maxDocuments ?? Math.min(250, config.MAX_NEW_LEADS_PER_DAY * 5),
  });
  const output = resolve(args.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(batch, null, 2)}\n`, "utf8");
  process.stdout.write(
    `${JSON.stringify({ event: "a1_batch_prepared", output, documents: batch.documents.length, sourceFailures: batch.sourceFailures })}\n`,
  );
  return output;
}

prepareA1FromEnvironment(process.env, process.argv.slice(2)).catch(
  (error: unknown) => {
    const name = error instanceof Error ? error.name : "UnknownError";
    const message = error instanceof Error ? error.message : "Unknown failure";
    process.stderr.write(
      `${JSON.stringify({ event: "a1_prepare_failed", name, message })}\n`,
    );
    process.exitCode = 1;
  },
);
