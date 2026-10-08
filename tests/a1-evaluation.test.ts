import { describe, expect, it } from "vitest";

import {
  a1EvaluationCaseSchema,
  scoreA1Evaluation,
  type A1EvaluationCase,
} from "../src/evaluation/a1.js";

const buildCase = (index: number): A1EvaluationCase => {
  const indexText = String(index);
  return {
    caseId: `case-${indexText}`,
    candidate: {
      company: `Company ${indexText}`,
      website: `company-${indexText}.example`,
      signal: "Funding round",
      signal_date: "2026-10-06",
      signal_url: `https://news.example/article-${indexText}`,
      segment: "Seed-stage SaaS",
      reason: "Announced a seed funding round.",
    },
    sourceType: "search_query",
    provider: "gdelt",
    sourceQuery: "seed funding",
    retrievedAt: "2026-10-07T02:00:00.000Z",
    human: {
      verdict: "qualified",
      fitScore: 4,
      companyCorrect: true,
      signalCorrect: true,
      websiteCorrect: true,
      evidenceUrlResolvable: true,
      evidenceSupportsSignal: true,
      duplicateOfCaseId: null,
      dncViolation: false,
      reviewSeconds: index + 1,
      rejectReasons: [],
    },
    a2: {
      fitScore: 4,
      factsSupported: true,
      sourcesResolvable: true,
      sources: [`https://news.example/article-${indexText}`],
    },
    costInr: 1,
  };
};

describe("A1 evaluation contract", () => {
  it("accepts a well-formed evaluation case", () => {
    expect(a1EvaluationCaseSchema.parse(buildCase(1))).toBeDefined();
  });

  it("requires rejection reasons for rejected cases", () => {
    const evaluationCase = buildCase(1);
    evaluationCase.human.verdict = "reject";

    expect(() => a1EvaluationCaseSchema.parse(evaluationCase)).toThrow(
      /rejection reason/,
    );
  });

  it("requires the website check only when A1 supplies a website", () => {
    const evaluationCase = buildCase(1);
    evaluationCase.candidate.website = null;

    expect(() => a1EvaluationCaseSchema.parse(evaluationCase)).toThrow(
      /websiteCorrect must be null/,
    );

    evaluationCase.human.websiteCorrect = null;
    expect(a1EvaluationCaseSchema.parse(evaluationCase)).toBeDefined();
  });
});

describe("A1 evaluation release gate", () => {
  it("passes a complete, high-quality 100-case corpus", () => {
    const scorecard = scoreA1Evaluation(
      Array.from({ length: 100 }, (_, index) => buildCase(index)),
    );

    expect(scorecard.passed).toBe(true);
    expect(scorecard.sampleSize).toBe(100);
    expect(scorecard.usefulCount).toBe(100);
    expect(scorecard.medianReviewSeconds).toBe(50.5);
    expect(scorecard.totalCostInr).toBe(100);
    expect(scorecard.costPerUsefulLeadInr).toBe(1);
  });

  it("fails when the useful rate falls below 60 percent", () => {
    const cases = Array.from({ length: 100 }, (_, index) => buildCase(index));
    for (const evaluationCase of cases.slice(0, 41)) {
      evaluationCase.human.verdict = "reject";
      evaluationCase.human.rejectReasons = ["outside_icp"];
    }

    const scorecard = scoreA1Evaluation(cases);
    const usefulGate = scorecard.gates.find(
      ({ name }) => name === "useful_rate",
    );

    expect(scorecard.passed).toBe(false);
    expect(usefulGate).toMatchObject({ actual: 0.59, passed: false });
  });

  it("fails on any unsupported A2 fact", () => {
    const cases = Array.from({ length: 100 }, (_, index) => buildCase(index));
    const firstCase = cases[0];
    if (firstCase?.a2 === null || firstCase === undefined) {
      throw new Error("expected a populated A2 result");
    }
    firstCase.a2.factsSupported = false;

    const scorecard = scoreA1Evaluation(cases);
    const supportGate = scorecard.gates.find(
      ({ name }) => name === "a2_fact_support_rate",
    );

    expect(scorecard.passed).toBe(false);
    expect(supportGate).toMatchObject({ actual: 0.99, passed: false });
  });

  it("rejects corpora that are not exactly 100 unique cases", () => {
    expect(() =>
      scoreA1Evaluation(
        Array.from({ length: 99 }, (_, index) => buildCase(index)),
      ),
    ).toThrow();

    const duplicateCases = Array.from({ length: 100 }, (_, index) =>
      buildCase(index),
    );
    const firstCase = duplicateCases[0];
    const lastCase = duplicateCases[99];
    if (firstCase === undefined || lastCase === undefined) {
      throw new Error("expected a 100-case corpus");
    }
    lastCase.caseId = firstCase.caseId;

    expect(() => scoreA1Evaluation(duplicateCases)).toThrow(/unique/);
  });
});
