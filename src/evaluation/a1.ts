import { z } from "zod";

import { a1LeadScoutOutputSchema } from "../llm/schemas/agents.js";
import {
  isoDateTimeSchema,
  nonEmptyTextSchema,
  urlSchema,
} from "../models/common.js";
import { sourceTypeSchema } from "../models/enums.js";

export const A1_EVALUATION_THRESHOLDS = {
  sampleSize: 100,
  minimumUsefulRate: 0.6,
  minimumCompanyAccuracy: 0.95,
  minimumSignalAccuracy: 0.85,
  minimumWebsiteAccuracy: 0.95,
  minimumEvidenceResolutionRate: 0.95,
  minimumEvidenceSupportRate: 1,
  maximumDuplicateRate: 0.02,
  maximumDncViolations: 0,
  minimumA2CoverageRate: 1,
  minimumA2WithinOnePointRate: 0.8,
  minimumA2FactSupportRate: 1,
} as const;

export const a1EvaluationVerdictSchema = z.enum([
  "qualified",
  "plausible",
  "reject",
]);

export const a1EvaluationRejectReasonSchema = z.enum([
  "wrong_company",
  "no_buying_signal",
  "stale_signal",
  "outside_icp",
  "duplicate",
  "dnc",
  "unverifiable",
  "other",
]);

const humanReviewSchema = z
  .object({
    verdict: a1EvaluationVerdictSchema,
    fitScore: z.number().int().min(1).max(5),
    companyCorrect: z.boolean(),
    signalCorrect: z.boolean(),
    websiteCorrect: z.boolean().nullable(),
    evidenceUrlResolvable: z.boolean(),
    evidenceSupportsSignal: z.boolean(),
    duplicateOfCaseId: nonEmptyTextSchema.nullable(),
    dncViolation: z.boolean(),
    reviewSeconds: z.number().int().positive(),
    rejectReasons: z.array(a1EvaluationRejectReasonSchema),
  })
  .strict()
  .superRefine((review, context) => {
    if (review.verdict === "reject" && review.rejectReasons.length === 0) {
      context.addIssue({
        code: "custom",
        message: "rejected cases require at least one rejection reason",
        path: ["rejectReasons"],
      });
    }

    if (review.verdict !== "reject" && review.rejectReasons.length > 0) {
      context.addIssue({
        code: "custom",
        message: "non-rejected cases cannot have rejection reasons",
        path: ["rejectReasons"],
      });
    }
  });

const minimalA2ReviewSchema = z
  .object({
    fitScore: z.number().int().min(1).max(5),
    factsSupported: z.boolean(),
    sourcesResolvable: z.boolean(),
    sources: z.array(urlSchema).min(1),
  })
  .strict();

export const a1EvaluationCaseSchema = z
  .object({
    caseId: nonEmptyTextSchema,
    candidate: a1LeadScoutOutputSchema,
    sourceType: sourceTypeSchema,
    provider: nonEmptyTextSchema,
    sourceQuery: nonEmptyTextSchema,
    retrievedAt: isoDateTimeSchema,
    human: humanReviewSchema,
    a2: minimalA2ReviewSchema.nullable(),
    costInr: z.number().nonnegative().nullable(),
  })
  .strict()
  .superRefine((evaluationCase, context) => {
    if (
      evaluationCase.candidate.website === null &&
      evaluationCase.human.websiteCorrect !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "websiteCorrect must be null when A1 supplied no website",
        path: ["human", "websiteCorrect"],
      });
    }

    if (
      evaluationCase.candidate.website !== null &&
      evaluationCase.human.websiteCorrect === null
    ) {
      context.addIssue({
        code: "custom",
        message: "websiteCorrect is required when A1 supplied a website",
        path: ["human", "websiteCorrect"],
      });
    }
  });

export const a1EvaluationCorpusSchema = z
  .array(a1EvaluationCaseSchema)
  .length(A1_EVALUATION_THRESHOLDS.sampleSize)
  .superRefine((cases, context) => {
    const caseIds = new Set<string>();
    for (const [index, evaluationCase] of cases.entries()) {
      if (caseIds.has(evaluationCase.caseId)) {
        context.addIssue({
          code: "custom",
          message: "caseId must be unique",
          path: [index, "caseId"],
        });
      }
      caseIds.add(evaluationCase.caseId);
    }
  });

export interface A1EvaluationGate {
  name: string;
  actual: number;
  threshold: number;
  passed: boolean;
}

export interface A1EvaluationScorecard {
  sampleSize: number;
  usefulCount: number;
  gates: readonly A1EvaluationGate[];
  passed: boolean;
  medianReviewSeconds: number;
  totalCostInr: number | null;
  costPerUsefulLeadInr: number | null;
}

const rate = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) {
    return 0;
  }
  const midpoint = Math.floor(sorted.length / 2);
  const upper = sorted[midpoint];
  if (upper === undefined) {
    return 0;
  }
  if (sorted.length % 2 !== 0) {
    return upper;
  }
  const lower = sorted[midpoint - 1];
  return lower === undefined ? upper : (lower + upper) / 2;
};

export const scoreA1Evaluation = (
  unparsedCases: readonly unknown[],
): A1EvaluationScorecard => {
  const cases = a1EvaluationCorpusSchema.parse(unparsedCases);
  const sampleSize = cases.length;
  const usefulCount = cases.filter(
    ({ human }) => human.verdict !== "reject",
  ).length;
  const populatedWebsites = cases.filter(
    ({ human }) => human.websiteCorrect !== null,
  );
  const a2Cases = cases.flatMap((evaluationCase) =>
    evaluationCase.a2 === null
      ? []
      : [{ a2: evaluationCase.a2, human: evaluationCase.human }],
  );
  const a2WithinOnePoint = a2Cases.filter(
    ({ a2, human }) => Math.abs(a2.fitScore - human.fitScore) <= 1,
  ).length;
  const duplicateCount = cases.filter(
    ({ human }) => human.duplicateOfCaseId !== null,
  ).length;
  const dncViolations = cases.filter(({ human }) => human.dncViolation).length;

  const metrics = {
    sampleSize,
    usefulRate: rate(usefulCount, sampleSize),
    companyAccuracy: rate(
      cases.filter(({ human }) => human.companyCorrect).length,
      sampleSize,
    ),
    signalAccuracy: rate(
      cases.filter(({ human }) => human.signalCorrect).length,
      sampleSize,
    ),
    websiteAccuracy:
      populatedWebsites.length === 0
        ? 1
        : rate(
            populatedWebsites.filter(({ human }) => human.websiteCorrect)
              .length,
            populatedWebsites.length,
          ),
    evidenceResolutionRate: rate(
      cases.filter(({ human }) => human.evidenceUrlResolvable).length,
      sampleSize,
    ),
    evidenceSupportRate: rate(
      cases.filter(({ human }) => human.evidenceSupportsSignal).length,
      sampleSize,
    ),
    duplicateRate: rate(duplicateCount, sampleSize),
    dncViolations,
    a2CoverageRate: rate(a2Cases.length, sampleSize),
    a2WithinOnePointRate: rate(a2WithinOnePoint, a2Cases.length),
    a2FactSupportRate: rate(
      a2Cases.filter(({ a2 }) => a2.factsSupported && a2.sourcesResolvable)
        .length,
      a2Cases.length,
    ),
  };

  const thresholds = A1_EVALUATION_THRESHOLDS;
  const gates: A1EvaluationGate[] = [
    {
      name: "sample_size",
      actual: metrics.sampleSize,
      threshold: thresholds.sampleSize,
      passed: metrics.sampleSize === thresholds.sampleSize,
    },
    {
      name: "useful_rate",
      actual: metrics.usefulRate,
      threshold: thresholds.minimumUsefulRate,
      passed: metrics.usefulRate >= thresholds.minimumUsefulRate,
    },
    {
      name: "company_accuracy",
      actual: metrics.companyAccuracy,
      threshold: thresholds.minimumCompanyAccuracy,
      passed: metrics.companyAccuracy >= thresholds.minimumCompanyAccuracy,
    },
    {
      name: "signal_accuracy",
      actual: metrics.signalAccuracy,
      threshold: thresholds.minimumSignalAccuracy,
      passed: metrics.signalAccuracy >= thresholds.minimumSignalAccuracy,
    },
    {
      name: "website_accuracy",
      actual: metrics.websiteAccuracy,
      threshold: thresholds.minimumWebsiteAccuracy,
      passed: metrics.websiteAccuracy >= thresholds.minimumWebsiteAccuracy,
    },
    {
      name: "evidence_resolution_rate",
      actual: metrics.evidenceResolutionRate,
      threshold: thresholds.minimumEvidenceResolutionRate,
      passed:
        metrics.evidenceResolutionRate >=
        thresholds.minimumEvidenceResolutionRate,
    },
    {
      name: "evidence_support_rate",
      actual: metrics.evidenceSupportRate,
      threshold: thresholds.minimumEvidenceSupportRate,
      passed:
        metrics.evidenceSupportRate >= thresholds.minimumEvidenceSupportRate,
    },
    {
      name: "duplicate_rate",
      actual: metrics.duplicateRate,
      threshold: thresholds.maximumDuplicateRate,
      passed: metrics.duplicateRate <= thresholds.maximumDuplicateRate,
    },
    {
      name: "dnc_violations",
      actual: metrics.dncViolations,
      threshold: thresholds.maximumDncViolations,
      passed: metrics.dncViolations <= thresholds.maximumDncViolations,
    },
    {
      name: "a2_coverage_rate",
      actual: metrics.a2CoverageRate,
      threshold: thresholds.minimumA2CoverageRate,
      passed: metrics.a2CoverageRate >= thresholds.minimumA2CoverageRate,
    },
    {
      name: "a2_within_one_point_rate",
      actual: metrics.a2WithinOnePointRate,
      threshold: thresholds.minimumA2WithinOnePointRate,
      passed:
        metrics.a2WithinOnePointRate >= thresholds.minimumA2WithinOnePointRate,
    },
    {
      name: "a2_fact_support_rate",
      actual: metrics.a2FactSupportRate,
      threshold: thresholds.minimumA2FactSupportRate,
      passed: metrics.a2FactSupportRate >= thresholds.minimumA2FactSupportRate,
    },
  ];

  const knownCosts = cases.map(({ costInr }) => costInr);
  const totalCostInr = knownCosts.every((cost) => cost !== null)
    ? knownCosts.reduce<number>((total, cost) => total + cost, 0)
    : null;

  return {
    sampleSize,
    usefulCount,
    gates,
    passed: gates.every((gate) => gate.passed),
    medianReviewSeconds: median(cases.map(({ human }) => human.reviewSeconds)),
    totalCostInr,
    costPerUsefulLeadInr:
      totalCostInr === null || usefulCount === 0
        ? null
        : totalCostInr / usefulCount,
  };
};

export type A1EvaluationCase = z.infer<typeof a1EvaluationCaseSchema>;
