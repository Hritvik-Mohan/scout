import { createHash } from "node:crypto";

import { z } from "zod";

import { checkDailyCap } from "../core/caps.js";
import { findDuplicate, normalizeDomain } from "../core/dedup.js";
import { matchDoNotContact } from "../core/dnc.js";
import {
  discoveryDocumentSchema,
  type DiscoveryAdapter,
  type DiscoveryDocument,
} from "../discovery/contracts.js";
import { a1LeadScoutOutputSchema } from "../llm/schemas/agents.js";
import {
  isoDateTimeSchema,
  nonEmptyTextSchema,
  runIdSchema,
} from "../models/common.js";
import type {
  DryRunOutputRow,
  PipelineLead,
  SourceRow,
} from "../models/tracker.js";
import type {
  AgentExecutionContext,
  AgentWorkResult,
  PipelineAgent,
} from "../runtime/run.js";
import type { TrackerRepository } from "../tracker/repository.js";

export const A1_CODEX_SCHEMA_VERSION = 1;

const sourceFailureSchema = z
  .object({
    sourceId: nonEmptyTextSchema,
    error: nonEmptyTextSchema,
  })
  .strict();

export const a1PreparedBatchSchema = z
  .object({
    schemaVersion: z.literal(A1_CODEX_SCHEMA_VERSION),
    batchId: runIdSchema,
    preparedAt: isoDateTimeSchema,
    window: z
      .object({
        startAt: isoDateTimeSchema,
        endAt: isoDateTimeSchema,
      })
      .strict(),
    documents: z.array(discoveryDocumentSchema),
    sourceFailures: z.array(sourceFailureSchema),
  })
  .strict();

const acceptedDecisionSchema = z
  .object({
    documentId: nonEmptyTextSchema,
    status: z.literal("accepted"),
    candidate: a1LeadScoutOutputSchema,
  })
  .strict();

const rejectedDecisionSchema = z
  .object({
    documentId: nonEmptyTextSchema,
    status: z.literal("rejected"),
    reason: z.enum([
      "no_buying_signal",
      "unverifiable",
      "stale",
      "outside_icp",
      "duplicate_document",
      "other",
    ]),
    detail: nonEmptyTextSchema,
  })
  .strict();

export const a1CodexResultSchema = z
  .object({
    schemaVersion: z.literal(A1_CODEX_SCHEMA_VERSION),
    batchId: runIdSchema,
    model: z.literal("codex"),
    decisions: z.array(
      z.discriminatedUnion("status", [
        acceptedDecisionSchema,
        rejectedDecisionSchema,
      ]),
    ),
  })
  .strict();

export const a1ProposedLeadSchema = z
  .object({
    leadId: nonEmptyTextSchema,
    company: nonEmptyTextSchema,
    website: nonEmptyTextSchema.nullable(),
    source: z.enum([
      "Funding news",
      "Job post",
      "Accelerator",
      "LinkedIn",
      "Other",
    ]),
    signal: a1LeadScoutOutputSchema.shape.signal,
    signalDate: a1LeadScoutOutputSchema.shape.signal_date,
    signalUrl: a1LeadScoutOutputSchema.shape.signal_url,
    industry: nonEmptyTextSchema,
    stage: z.literal("New"),
    researchSummary: nonEmptyTextSchema,
    researchSources: z
      .array(a1LeadScoutOutputSchema.shape.signal_url)
      .length(1),
    lastAgentRun: isoDateTimeSchema,
    stageChangedAt: isoDateTimeSchema,
    stageChangedBy: z.literal("A1"),
  })
  .strict();

export type A1PreparedBatch = z.infer<typeof a1PreparedBatchSchema>;
export type A1CodexResult = z.infer<typeof a1CodexResultSchema>;
export type A1ProposedLead = z.infer<typeof a1ProposedLeadSchema>;

export interface PrepareA1BatchOptions {
  batchId: string;
  sources: readonly SourceRow[];
  adapters: readonly DiscoveryAdapter[];
  startAt: Date;
  endAt: Date;
  maxDocuments: number;
  now?: () => Date;
}

export interface A1CommitSummary {
  accepted: number;
  rejectedByCodex: number;
  rejectedDuplicate: number;
  rejectedDnc: number;
  rejectedInvalidEvidence: number;
  rejectedCap: number;
  leadIds: readonly string[];
}

export interface CommitA1BatchOptions {
  batch: A1PreparedBatch;
  result: A1CodexResult;
  tracker: TrackerRepository;
  dailyCap: number;
  createdAt?: string;
}

export class A1CodexValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "A1CodexValidationError";
  }
}

export const canonicalizeEvidenceUrl = (value: string): string => {
  const url = new URL(value);
  url.hash = "";
  for (const name of [...url.searchParams.keys()]) {
    if (
      name.toLowerCase().startsWith("utm_") ||
      ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(name.toLowerCase())
    ) {
      url.searchParams.delete(name);
    }
  }
  url.searchParams.sort();
  return url.toString();
};

const safeError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "Unknown failure";
  return message.replaceAll(/\s+/g, " ").trim().slice(0, 300);
};

export async function prepareA1CodexBatch(
  options: PrepareA1BatchOptions,
): Promise<A1PreparedBatch> {
  if (!Number.isInteger(options.maxDocuments) || options.maxDocuments < 1) {
    throw new RangeError("maxDocuments must be a positive integer");
  }

  const adapterByType = new Map(
    options.adapters.map((adapter) => [adapter.sourceType, adapter]),
  );
  const documents: DiscoveryDocument[] = [];
  const sourceFailures: z.infer<typeof sourceFailureSchema>[] = [];
  const seenUrls = new Set<string>();

  for (const source of options.sources.filter(
    (candidate) => candidate.active,
  )) {
    if (documents.length >= options.maxDocuments) break;
    if (source.type === "job_search") {
      sourceFailures.push({
        sourceId: source.sourceId,
        error: "job_search is disabled for the 100-lead evaluation",
      });
      continue;
    }
    const adapter = adapterByType.get(source.type);
    if (adapter === undefined) {
      sourceFailures.push({
        sourceId: source.sourceId,
        error: `No discovery adapter configured for ${source.type}`,
      });
      continue;
    }

    try {
      const discovered = await adapter.discover({
        source,
        startAt: options.startAt,
        endAt: options.endAt,
        maxResults: Math.min(250, options.maxDocuments - documents.length),
      });
      for (const document of discovered) {
        const canonical = canonicalizeEvidenceUrl(document.url);
        if (seenUrls.has(canonical)) continue;
        seenUrls.add(canonical);
        documents.push({ ...document, url: canonical });
      }
    } catch (error) {
      sourceFailures.push({
        sourceId: source.sourceId,
        error: safeError(error),
      });
    }
  }

  return a1PreparedBatchSchema.parse({
    schemaVersion: A1_CODEX_SCHEMA_VERSION,
    batchId: options.batchId,
    preparedAt: (options.now ?? (() => new Date()))().toISOString(),
    window: {
      startAt: options.startAt.toISOString(),
      endAt: options.endAt.toISOString(),
    },
    documents,
    sourceFailures,
  });
}

const deterministicUuid = (value: string): string => {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  const versioned = `${hex.slice(0, 12)}4${hex.slice(13, 16)}a${hex.slice(17)}`;
  return `${versioned.slice(0, 8)}-${versioned.slice(8, 12)}-${versioned.slice(12, 16)}-${versioned.slice(16, 20)}-${versioned.slice(20, 32)}`;
};

const sourceForSignal = (
  signal: A1ProposedLead["signal"],
): A1ProposedLead["source"] => {
  switch (signal) {
    case "Funding round":
      return "Funding news";
    case "Contract dev job post":
      return "Job post";
    case "Accelerator batch":
      return "Accelerator";
    case "Public post asking for devs":
      return "LinkedIn";
    default:
      return "Other";
  }
};

const dryRunCandidates = (
  outputs: readonly DryRunOutputRow[],
): { company: string; website: string | null }[] =>
  outputs.flatMap((output) => {
    if (
      output.agent !== "A1" ||
      output.proposedOperation !== "create_pipeline_lead"
    ) {
      return [];
    }
    const parsed = a1ProposedLeadSchema.safeParse(output.proposedValue);
    return parsed.success
      ? [{ company: parsed.data.company, website: parsed.data.website }]
      : [];
  });

const ensureCompleteDecisionSet = (
  batch: A1PreparedBatch,
  result: A1CodexResult,
): void => {
  if (batch.batchId !== result.batchId) {
    throw new A1CodexValidationError(
      "result batchId does not match prepared batch",
    );
  }
  const expected = new Set(
    batch.documents.map((document) => document.documentId),
  );
  const actual = new Set<string>();
  for (const decision of result.decisions) {
    if (!expected.has(decision.documentId)) {
      throw new A1CodexValidationError(
        `unknown documentId ${decision.documentId}`,
      );
    }
    if (actual.has(decision.documentId)) {
      throw new A1CodexValidationError(
        `duplicate decision for ${decision.documentId}`,
      );
    }
    actual.add(decision.documentId);
  }
  if (actual.size !== expected.size) {
    const missing = [...expected].filter(
      (documentId) => !actual.has(documentId),
    );
    throw new A1CodexValidationError(
      `missing decisions for: ${missing.join(", ")}`,
    );
  }
};

export async function commitA1CodexBatch(
  options: CommitA1BatchOptions,
): Promise<A1CommitSummary> {
  const batch = a1PreparedBatchSchema.parse(options.batch);
  const result = a1CodexResultSchema.parse(options.result);
  ensureCompleteDecisionSet(batch, result);

  const createdAt = options.createdAt ?? new Date().toISOString();
  const date = createdAt.slice(0, 10);
  const documents = new Map(
    batch.documents.map((document) => [document.documentId, document]),
  );
  const [leads, dnc, previousOutputs] = await Promise.all([
    options.tracker.listLeads(),
    options.tracker.listDoNotContact(),
    options.tracker.listDryRunOutputs(),
  ]);
  const existing: { company: string; website?: string | null }[] = [
    ...leads.map((lead: PipelineLead) => ({
      company: lead.company,
      website: lead.website,
    })),
    ...dryRunCandidates(previousOutputs),
  ];
  let createdToday = previousOutputs.filter(
    (output) =>
      output.agent === "A1" &&
      output.proposedOperation === "create_pipeline_lead" &&
      output.createdAt.slice(0, 10) === date,
  ).length;
  const summary: A1CommitSummary = {
    accepted: 0,
    rejectedByCodex: 0,
    rejectedDuplicate: 0,
    rejectedDnc: 0,
    rejectedInvalidEvidence: 0,
    rejectedCap: 0,
    leadIds: [],
  };
  const leadIds: string[] = [];

  for (const decision of result.decisions) {
    if (decision.status === "rejected") {
      summary.rejectedByCodex += 1;
      continue;
    }
    const document = documents.get(decision.documentId);
    if (document === undefined) {
      throw new A1CodexValidationError(
        `missing document ${decision.documentId}`,
      );
    }
    const candidate = decision.candidate;
    if (
      canonicalizeEvidenceUrl(candidate.signal_url) !== document.url ||
      candidate.signal_date !== document.publishedAt.slice(0, 10) ||
      candidate.segment !== document.segment
    ) {
      summary.rejectedInvalidEvidence += 1;
      continue;
    }

    const website = normalizeDomain(candidate.website);
    if (
      findDuplicate({ company: candidate.company, website }, existing) !== null
    ) {
      summary.rejectedDuplicate += 1;
      continue;
    }
    if (
      matchDoNotContact(
        { website },
        dnc.map((entry) => ({
          kind: entry.kind,
          normalizedValue: entry.normalizedValue,
        })),
      ).blocked
    ) {
      summary.rejectedDnc += 1;
      continue;
    }
    if (!checkDailyCap(createdToday, options.dailyCap).allowed) {
      summary.rejectedCap += 1;
      continue;
    }

    const idempotencyKey = deterministicUuid(
      `${batch.batchId}:${decision.documentId}:create`,
    );
    const leadId = await options.tracker.allocateLeadId(date, idempotencyKey);
    const proposed = a1ProposedLeadSchema.parse({
      leadId,
      company: candidate.company,
      website,
      source: sourceForSignal(candidate.signal),
      signal: candidate.signal,
      signalDate: candidate.signal_date,
      signalUrl: document.url,
      industry: candidate.segment,
      stage: "New",
      researchSummary: candidate.reason,
      researchSources: [document.url],
      lastAgentRun: createdAt,
      stageChangedAt: createdAt,
      stageChangedBy: "A1",
    });
    await options.tracker.appendDryRunOutput(
      {
        runId: batch.batchId,
        agent: "A1",
        leadId,
        proposedOperation: "create_pipeline_lead",
        target: `Pipeline:${decision.documentId}`,
        proposedValue: proposed,
        createdAt,
      },
      idempotencyKey,
    );
    existing.push({ company: candidate.company, website });
    leadIds.push(leadId);
    createdToday += 1;
    summary.accepted += 1;
  }

  return { ...summary, leadIds };
}

export class A1CodexCommitAgent implements PipelineAgent {
  readonly id = "A1" as const;
  summary: A1CommitSummary | null = null;

  constructor(
    private readonly options: Omit<CommitA1BatchOptions, "createdAt">,
  ) {}

  async execute(context: AgentExecutionContext): Promise<AgentWorkResult> {
    if (!context.dryRun) {
      throw new Error("A1 Codex commit requires dry-run mode");
    }
    this.summary = await commitA1CodexBatch(this.options);
    return {
      status: this.summary.accepted === 0 ? "skipped" : "success",
      leadsProcessed: this.summary.accepted,
      leadIds: this.summary.leadIds,
      llmModel: "codex",
    };
  }
}
