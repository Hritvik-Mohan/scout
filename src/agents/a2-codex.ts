import { createHash } from "node:crypto";

import { z } from "zod";

import { a1ProposedLeadSchema } from "./a1-codex.js";
import {
  isoDateTimeSchema,
  nonEmptyTextSchema,
  runIdSchema,
  urlSchema,
} from "../models/common.js";
import type { DryRunOutputRow } from "../models/tracker.js";
import type {
  AgentExecutionContext,
  AgentWorkResult,
  PipelineAgent,
} from "../runtime/run.js";
import type { TrackerRepository } from "../tracker/repository.js";

const criterionSchema = z
  .object({
    met: z.boolean(),
    rationale: nonEmptyTextSchema,
    sources: z.array(urlSchema),
  })
  .strict()
  .superRefine((criterion, context) => {
    if (criterion.met && criterion.sources.length === 0) {
      context.addIssue({
        code: "custom",
        message: "a met criterion requires evidence",
        path: ["sources"],
      });
    }
  });

const icpMatchSchema = z
  .object({
    tier: z.enum(["primary", "secondary", "tertiary", "other"]),
    caseStudy: z.enum(["Maverick", "Zuvees", "RishiVerse", "IITR", "None"]),
    rationale: nonEmptyTextSchema,
    sources: z.array(urlSchema),
  })
  .strict();

const publicContactSchema = z
  .object({
    decisionMaker: z.string().trim().min(1).nullable(),
    role: z.string().trim().min(1).nullable(),
    publicEmail: z.string().trim().email().nullable(),
    emailUsability: z
      .enum([
        "usable_for_outreach",
        "partnership_only",
        "support_or_research_only",
        "media_only",
        "do_not_use",
        "not_researched",
      ])
      .default("not_researched"),
    emailSource: urlSchema.nullable(),
  })
  .strict()
  .superRefine((contact, context) => {
    if (contact.publicEmail !== null && contact.emailSource === null) {
      context.addIssue({
        code: "custom",
        message: "a public email requires a public source URL",
        path: ["emailSource"],
      });
    }
  });

export const a2DisqualifierSchema = z.enum([
  "students_without_mentor",
  "hourly_or_staff_augmentation",
  "budget_below_discovery",
  "no_reachable_decision_maker",
  "unsupported_regulatory_or_safety_risk",
  "daily_mentor_availability_required",
]);

export const a2PreparedBatchSchema = z
  .object({
    schemaVersion: z.literal(1),
    batchId: runIdSchema,
    preparedAt: isoDateTimeSchema,
    leads: z.array(a1ProposedLeadSchema),
  })
  .strict();

export const a2CodexResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    batchId: runIdSchema,
    model: z.literal("codex"),
    reviews: z.array(
      z
        .object({
          leadId: nonEmptyTextSchema,
          signal: z
            .object({
              supported: z.boolean(),
              rationale: nonEmptyTextSchema,
              sources: z.array(urlSchema).min(1),
            })
            .strict(),
          criteria: z
            .object({
              geography: z
                .object({
                  market: z.enum(["india", "international", "unknown"]),
                  rationale: nonEmptyTextSchema,
                  sources: z.array(urlSchema),
                })
                .strict(),
              icpMatch: icpMatchSchema,
              buyingSignalAndNeed: criterionSchema,
              budgetFit: criterionSchema,
              buyingProcessAndDeliveryFit: criterionSchema,
            })
            .strict(),
          disqualifiers: z.array(a2DisqualifierSchema),
          unverified: z.array(nonEmptyTextSchema),
          contact: publicContactSchema.optional(),
        })
        .strict(),
    ),
  })
  .strict();

export const a2ProposedReviewSchema = z
  .object({
    leadId: nonEmptyTextSchema,
    signalSupported: z.boolean(),
    fitScore: z.number().int().min(1).max(5),
    fitPoints: z.array(nonEmptyTextSchema),
    icpTier: z.enum(["primary", "secondary", "tertiary", "other"]),
    geography: z.enum(["india", "international", "unknown"]),
    outreachPriority: z.enum([
      "india_first",
      "international_second",
      "location_unverified",
    ]),
    caseStudy: z.enum(["Maverick", "Zuvees", "RishiVerse", "IITR", "None"]),
    criteria: z.unknown(),
    disqualifiers: z.array(a2DisqualifierSchema),
    sources: z.array(urlSchema).min(1),
    unverified: z.array(nonEmptyTextSchema),
    contact: publicContactSchema.optional(),
  })
  .strict();

export type A2PreparedBatch = z.infer<typeof a2PreparedBatchSchema>;
export type A2CodexResult = z.infer<typeof a2CodexResultSchema>;
export type A2ProposedReview = z.infer<typeof a2ProposedReviewSchema>;

const uuidFor = (value: string): string => {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  const versioned = `${hex.slice(0, 12)}4${hex.slice(13, 16)}a${hex.slice(17)}`;
  return `${versioned.slice(0, 8)}-${versioned.slice(8, 12)}-${versioned.slice(12, 16)}-${versioned.slice(16, 20)}-${versioned.slice(20)}`;
};

export function prepareA2CodexBatch(
  outputs: readonly DryRunOutputRow[],
  batchId: string,
  preparedAt: string,
  limit: number,
): A2PreparedBatch {
  const reviewed = new Set(
    outputs
      .filter(
        (row) =>
          row.agent === "A2" &&
          row.proposedOperation === "verify_and_score_lead",
      )
      .flatMap((row) => (row.leadId === null ? [] : [row.leadId])),
  );
  const leads = outputs
    .filter(
      (row) =>
        row.agent === "A1" && row.proposedOperation === "create_pipeline_lead",
    )
    .flatMap((row) => {
      const parsed = a1ProposedLeadSchema.safeParse(row.proposedValue);
      return parsed.success && !reviewed.has(parsed.data.leadId)
        ? [parsed.data]
        : [];
    })
    .slice(0, limit);
  return a2PreparedBatchSchema.parse({
    schemaVersion: 1,
    batchId,
    preparedAt,
    leads,
  });
}

export async function commitA2CodexBatch(options: {
  batch: A2PreparedBatch;
  result: A2CodexResult;
  tracker: TrackerRepository;
  createdAt?: string;
}): Promise<{ accepted: number; leadIds: readonly string[] }> {
  const batch = a2PreparedBatchSchema.parse(options.batch);
  const result = a2CodexResultSchema.parse(options.result);
  if (batch.batchId !== result.batchId)
    throw new Error("A2 result batchId mismatch");
  const leads = new Map(batch.leads.map((lead) => [lead.leadId, lead]));
  if (
    result.reviews.length !== leads.size ||
    new Set(result.reviews.map((review) => review.leadId)).size !== leads.size
  ) {
    throw new Error("A2 requires exactly one unique review per prepared lead");
  }
  const createdAt = options.createdAt ?? new Date().toISOString();
  const leadIds: string[] = [];
  for (const review of result.reviews) {
    const lead = leads.get(review.leadId);
    if (lead === undefined) throw new Error(`Unknown A2 lead ${review.leadId}`);
    if (
      review.signal.supported &&
      !review.signal.sources.includes(lead.signalUrl)
    ) {
      throw new Error(
        `A2 signal evidence must include the A1 signal URL for ${lead.leadId}`,
      );
    }
    const daysOld =
      (Date.parse(batch.preparedAt) -
        Date.parse(`${lead.signalDate}T00:00:00.000Z`)) /
      86_400_000;
    const recentNeed =
      daysOld >= 0 && daysOld <= 30 && review.criteria.buyingSignalAndNeed.met;
    const icpPoints =
      review.criteria.icpMatch.tier === "primary"
        ? 2
        : review.criteria.icpMatch.tier === "other"
          ? 0
          : 1;
    const fitPoints = [
      ...(icpPoints === 2
        ? ["primary_icp", "primary_icp_weight"]
        : icpPoints === 1
          ? [`${review.criteria.icpMatch.tier}_icp`]
          : []),
      ...(recentNeed ? ["buying_signal_and_need"] : []),
      ...(review.criteria.budgetFit.met ? ["budget_fit"] : []),
      ...(review.criteria.buyingProcessAndDeliveryFit.met
        ? ["buying_process_and_delivery_fit"]
        : []),
    ];
    const criteriaSources = [
      ...review.criteria.geography.sources,
      ...review.criteria.icpMatch.sources,
      ...review.criteria.buyingSignalAndNeed.sources,
      ...review.criteria.budgetFit.sources,
      ...review.criteria.buyingProcessAndDeliveryFit.sources,
    ];
    const sources = [
      ...new Set([
        lead.signalUrl,
        ...review.signal.sources,
        ...criteriaSources,
      ]),
    ];
    const fitScore =
      review.disqualifiers.length > 0
        ? 1
        : Math.max(1, Math.min(5, fitPoints.length));
    const proposed = a2ProposedReviewSchema.parse({
      leadId: lead.leadId,
      signalSupported: review.signal.supported,
      fitScore,
      fitPoints,
      icpTier: review.criteria.icpMatch.tier,
      geography: review.criteria.geography.market,
      outreachPriority:
        review.criteria.geography.market === "india"
          ? "india_first"
          : review.criteria.geography.market === "international"
            ? "international_second"
            : "location_unverified",
      caseStudy: review.criteria.icpMatch.caseStudy,
      criteria: review.criteria,
      disqualifiers: review.disqualifiers,
      sources,
      unverified: review.unverified,
      contact: review.contact,
    });
    await options.tracker.appendDryRunOutput(
      {
        runId: batch.batchId,
        agent: "A2",
        leadId: lead.leadId,
        proposedOperation: "verify_and_score_lead",
        target: `Dry Run Output:${lead.leadId}`,
        proposedValue: proposed,
        createdAt,
      },
      uuidFor(`${batch.batchId}:${lead.leadId}:a2`),
    );
    leadIds.push(lead.leadId);
  }
  return { accepted: leadIds.length, leadIds };
}

export class A2CodexCommitAgent implements PipelineAgent {
  readonly id = "A2" as const;
  summary: { accepted: number; leadIds: readonly string[] } | null = null;
  constructor(
    private readonly options: Parameters<typeof commitA2CodexBatch>[0],
  ) {}
  async execute(context: AgentExecutionContext): Promise<AgentWorkResult> {
    if (!context.dryRun)
      throw new Error("A2 Codex commit requires dry-run mode");
    this.summary = await commitA2CodexBatch(this.options);
    return {
      status: this.summary.accepted === 0 ? "skipped" : "success",
      leadsProcessed: this.summary.accepted,
      leadIds: this.summary.leadIds,
      llmModel: "codex",
    };
  }
}
