import { z } from "zod";

import {
  domainOrUrlSchema,
  evidenceSchema,
  isoDateSchema,
  leadIdSchema,
  nonEmptyTextSchema,
  urlSchema,
} from "../../models/common.js";
import {
  agentSignalSchema,
  caseStudySchema,
  packageSchema,
  replyClassSchema,
  stageSchema,
} from "../../models/enums.js";

const nullableNonEmptyText = nonEmptyTextSchema.nullable();
const nullableUrl = urlSchema.nullable();
const factSourceSchema = z.union([urlSchema, z.literal("sales_brain")]);
const factUsedSchema = z
  .object({
    claim: nonEmptyTextSchema,
    source: factSourceSchema,
  })
  .strict();

export const a1LeadScoutOutputSchema = z
  .object({
    company: nonEmptyTextSchema,
    website: domainOrUrlSchema.nullable(),
    signal: agentSignalSchema,
    signal_date: isoDateSchema,
    signal_url: urlSchema,
    segment: nonEmptyTextSchema,
    reason: nonEmptyTextSchema,
  })
  .strict();

export const a2ResearchOutputSchema = z
  .object({
    what_they_do: nonEmptyTextSchema,
    stage_and_size: nonEmptyTextSchema,
    signal_summary: nonEmptyTextSchema,
    likely_needs: z.array(nonEmptyTextSchema).min(1),
    case_study: caseStudySchema,
    case_study_reason: nonEmptyTextSchema,
    package: packageSchema,
    fit_score: z.number().int().min(1).max(5),
    fit_points: z.array(nonEmptyTextSchema),
    contact: z
      .object({
        name: nullableNonEmptyText,
        role: nullableNonEmptyText,
        email: z.string().email().nullable(),
        linkedin_url: nullableUrl,
      })
      .strict(),
    sources: z.array(urlSchema).min(1),
    evidence: z.array(evidenceSchema).min(1),
    unverified: z.array(nonEmptyTextSchema),
  })
  .strict();

export const a3OutreachWriterOutputSchema = z
  .object({
    email_subjects: z.tuple([nonEmptyTextSchema, nonEmptyTextSchema]),
    email_body: nonEmptyTextSchema,
    linkedin_message: nonEmptyTextSchema,
    facts_used: z.array(factUsedSchema),
  })
  .strict();

export const a4FollowUpOutputSchema = z
  .object({
    touch_number: z.number().int().min(2),
    body: nonEmptyTextSchema,
    new_angle: nonEmptyTextSchema,
    facts_used: z.array(factUsedSchema),
  })
  .strict();

export const a5InboxTriageOutputSchema = z
  .object({
    reply_class: replyClassSchema,
    confidence: z.number().min(0).max(1),
    summary: nonEmptyTextSchema,
    return_date: isoDateSchema.nullable(),
    referral: z
      .object({
        name: nullableNonEmptyText,
        company: nullableNonEmptyText,
        email: z.string().email().nullable(),
      })
      .strict(),
    draft_body: nullableNonEmptyText,
  })
  .strict()
  .superRefine((output, context) => {
    if (output.confidence < 0.7 && output.reply_class !== "other") {
      context.addIssue({
        code: "custom",
        message: "must be other when confidence is below 0.7",
        path: ["reply_class"],
      });
    }

    if (output.reply_class === "unsubscribe" && output.draft_body !== null) {
      context.addIssue({
        code: "custom",
        message: "must be null for unsubscribe",
        path: ["draft_body"],
      });
    }
  });

export const a6CallPrepOutputSchema = z
  .object({
    sections: z
      .array(
        z
          .object({
            heading: nonEmptyTextSchema,
            content: nonEmptyTextSchema,
          })
          .strict(),
      )
      .length(7),
    sources: z.array(urlSchema),
    unverified: z.array(nonEmptyTextSchema),
  })
  .strict();

export const a7ProposalOutputSchema = z
  .object({
    scope_ratings: z
      .array(
        z
          .object({
            dimension: nonEmptyTextSchema,
            rating: z.enum(["Low", "Medium", "High"]),
            evidence: nonEmptyTextSchema,
          })
          .strict(),
      )
      .min(1),
    package: packageSchema,
    package_reason: nonEmptyTextSchema,
    price_inr: z.number().int().nonnegative(),
    included: z.array(nonEmptyTextSchema),
    not_included: z.array(nonEmptyTextSchema),
    milestones: z.array(
      z
        .object({
          name: nonEmptyTextSchema,
          deliverable: nonEmptyTextSchema,
          week: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    open_questions: z.array(nonEmptyTextSchema),
    capacity_warning: nullableNonEmptyText,
  })
  .strict()
  .refine((output) => output.package !== "Unknown", {
    message: "proposal package cannot be Unknown",
    path: ["package"],
  });

const namedRateSchema = z
  .object({
    name: nonEmptyTextSchema,
    rate: z.number().min(0).max(1),
  })
  .strict();

export const a8WeeklyReporterOutputSchema = z
  .object({
    leads_added: z.number().int().nonnegative(),
    messages_sent: z.number().int().nonnegative(),
    reply_rate_by_segment: z.array(namedRateSchema),
    reply_rate_by_case_study: z.array(namedRateSchema),
    calls_held: z.number().int().nonnegative(),
    proposals_sent: z.number().int().nonnegative(),
    wins: z.number().int().nonnegative(),
    value_by_stage: z.array(
      z
        .object({
          stage: stageSchema,
          value_inr_lakhs: z.number().nonnegative(),
        })
        .strict(),
    ),
    stuck_lead_ids: z.array(leadIdSchema),
    agent_failures: z.array(nonEmptyTextSchema),
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    suggestions: z.array(nonEmptyTextSchema).length(3),
  })
  .strict();

export const agentOutputSchemas = {
  A1: a1LeadScoutOutputSchema,
  A2: a2ResearchOutputSchema,
  A3: a3OutreachWriterOutputSchema,
  A4: a4FollowUpOutputSchema,
  A5: a5InboxTriageOutputSchema,
  A6: a6CallPrepOutputSchema,
  A7: a7ProposalOutputSchema,
  A8: a8WeeklyReporterOutputSchema,
} as const;

export type A1LeadScoutOutput = z.infer<typeof a1LeadScoutOutputSchema>;
export type A2ResearchOutput = z.infer<typeof a2ResearchOutputSchema>;
export type A3OutreachWriterOutput = z.infer<
  typeof a3OutreachWriterOutputSchema
>;
export type A4FollowUpOutput = z.infer<typeof a4FollowUpOutputSchema>;
export type A5InboxTriageOutput = z.infer<typeof a5InboxTriageOutputSchema>;
export type A6CallPrepOutput = z.infer<typeof a6CallPrepOutputSchema>;
export type A7ProposalOutput = z.infer<typeof a7ProposalOutputSchema>;
export type A8WeeklyReporterOutput = z.infer<
  typeof a8WeeklyReporterOutputSchema
>;
