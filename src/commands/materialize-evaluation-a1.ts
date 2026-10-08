import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { z } from "zod";

import {
  a1CodexResultSchema,
  a1PreparedBatchSchema,
} from "../agents/a1-codex.js";
import { nonEmptyTextSchema } from "../models/common.js";

const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    batchId: nonEmptyTextSchema,
    inputSha256: z.string().regex(/^[a-f0-9]{64}$/),
    defaultRejection: z
      .object({
        reason: z.literal("no_buying_signal"),
        detail: nonEmptyTextSchema,
      })
      .strict(),
    accepted: z.array(
      z
        .object({
          index: z.number().int().min(1).max(100),
          company: nonEmptyTextSchema,
          signal: z.enum(["Funding round", "Accelerator batch"]),
        })
        .strict(),
    ),
  })
  .strict();

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(resolve(path), "utf8")) as unknown;

const cleanHtml = (value: string): string =>
  value
    .replaceAll("&#8217;", "’")
    .replaceAll("&#038;", "&")
    .replaceAll("&amp;", "&")
    .replaceAll(/<[^>]+>/g, "")
    .trim();

export async function materializeEvaluationA1(): Promise<string> {
  const directory = ".local/evaluations/2026-10-07";
  const batch = a1PreparedBatchSchema.parse(
    await readJson(`${directory}/frozen-input.json`),
  );
  const manifest = manifestSchema.parse(
    await readJson("evaluations/2026-10-07-a1-decision-manifest.json"),
  );
  if (manifest.batchId !== batch.batchId)
    throw new Error("Evaluation batchId mismatch");
  const accepted = new Map(
    manifest.accepted.map((decision) => [decision.index, decision]),
  );
  if (accepted.size !== manifest.accepted.length) {
    throw new Error("Accepted evaluation indexes must be unique");
  }
  const decisions = batch.documents.map((document, zeroIndex) => {
    const classification = accepted.get(zeroIndex + 1);
    if (classification === undefined) {
      return {
        documentId: document.documentId,
        status: "rejected" as const,
        ...manifest.defaultRejection,
      };
    }
    return {
      documentId: document.documentId,
      status: "accepted" as const,
      candidate: {
        company: classification.company,
        website: null,
        signal: classification.signal,
        signal_date: document.publishedAt.slice(0, 10),
        signal_url: document.url,
        segment: document.segment,
        reason:
          classification.signal === "Funding round"
            ? cleanHtml(document.summary ?? document.title)
            : "The company was identified as a current Startup Battlefield 200 participant with a public launch.",
      },
    };
  });
  const result = a1CodexResultSchema.parse({
    schemaVersion: 1,
    batchId: batch.batchId,
    model: "codex",
    decisions,
  });
  const output = resolve(`${directory}/a1-result.json`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(
    `${JSON.stringify({ event: "evaluation_a1_materialized", output, decisions: decisions.length, accepted: accepted.size })}\n`,
  );
  return output;
}

materializeEvaluationA1().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ event: "evaluation_a1_materialize_failed", message: error instanceof Error ? error.message : "Unknown failure" })}\n`,
  );
  process.exitCode = 1;
});
