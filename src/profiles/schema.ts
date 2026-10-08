import { z } from "zod";

import { nonEmptyTextSchema, urlSchema } from "../models/common.js";

const idSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, {
  message: "must use lowercase snake_case",
});

export const purposeSchema = z.enum([
  "sales_leads",
  "freelance",
  "jobs",
  "partnerships",
  "grants",
  "custom",
]);

export const profileRuleSchema = z
  .object({
    id: idSchema,
    label: nonEmptyTextSchema,
    description: nonEmptyTextSchema,
    weight: z.number().positive(),
    required: z.boolean().default(false),
    evidenceRequired: z.boolean().default(true),
  })
  .strict();

export const disqualifierSchema = z
  .object({
    id: idSchema,
    label: nonEmptyTextSchema,
    description: nonEmptyTextSchema,
    hard: z.boolean().default(true),
  })
  .strict();

export const scoutProfileSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: idSchema,
    name: nonEmptyTextSchema,
    description: nonEmptyTextSchema,
    purpose: purposeSchema,
    targetEntity: nonEmptyTextSchema,
    geographyPriority: z.array(nonEmptyTextSchema).min(1),
    criteria: z.array(profileRuleSchema).min(1),
    signals: z.array(profileRuleSchema).default([]),
    disqualifiers: z.array(disqualifierSchema).default([]),
    thresholds: z
      .object({
        keep: z.number().min(1).max(5),
        action: z.number().min(1).max(5),
      })
      .strict()
      .refine((value) => value.action >= value.keep, {
        message: "action threshold must be greater than or equal to keep",
      }),
    outputFields: z.array(idSchema).min(1),
  })
  .strict()
  .superRefine((profile, context) => {
    const ids = [
      ...profile.criteria.map((rule) => rule.id),
      ...profile.signals.map((rule) => rule.id),
      ...profile.disqualifiers.map((rule) => rule.id),
    ];
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    for (const id of new Set(duplicates)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate rule id: ${id}`,
        path: ["criteria"],
      });
    }
  });

export const ruleAssessmentSchema = z
  .object({
    matched: z.boolean().nullable(),
    rationale: nonEmptyTextSchema,
    sources: z.array(urlSchema).default([]),
  })
  .strict();

export const opportunityAssessmentSchema = z
  .object({
    opportunityId: nonEmptyTextSchema,
    title: nonEmptyTextSchema,
    sourceUrl: urlSchema,
    geography: nonEmptyTextSchema,
    criteria: z.record(idSchema, ruleAssessmentSchema).default({}),
    signals: z.record(idSchema, ruleAssessmentSchema).default({}),
    disqualifiers: z.array(idSchema).default([]),
  })
  .strict();

export type ScoutProfile = z.infer<typeof scoutProfileSchema>;
export type ProfileRule = z.infer<typeof profileRuleSchema>;
export type OpportunityAssessment = z.infer<typeof opportunityAssessmentSchema>;
export type RuleAssessment = z.infer<typeof ruleAssessmentSchema>;
