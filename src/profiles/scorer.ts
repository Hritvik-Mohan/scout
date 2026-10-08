import type {
  OpportunityAssessment,
  ProfileRule,
  RuleAssessment,
  ScoutProfile,
} from "./schema.js";

export type ScoreStatus = "reject" | "hold" | "keep" | "action";

export interface RuleScore {
  id: string;
  matched: boolean | null;
  supported: boolean;
  earnedWeight: number;
  possibleWeight: number;
}

export interface ScoutScore {
  opportunityId: string;
  score: number;
  status: ScoreStatus;
  geographyRank: number;
  reasons: string[];
  rules: RuleScore[];
}

function scoreRule(
  rule: ProfileRule,
  assessment: RuleAssessment | undefined,
): RuleScore {
  const supported =
    assessment !== undefined &&
    (!rule.evidenceRequired || assessment.sources.length > 0);
  const matched = assessment?.matched ?? null;
  return {
    id: rule.id,
    matched,
    supported,
    earnedWeight: matched === true && supported ? rule.weight : 0,
    possibleWeight: rule.weight,
  };
}

export function scoreOpportunity(
  profile: ScoutProfile,
  assessment: OpportunityAssessment,
): ScoutScore {
  const knownDisqualifiers = new Set(
    profile.disqualifiers.map((item) => item.id),
  );
  const unknownDisqualifiers = assessment.disqualifiers.filter(
    (id) => !knownDisqualifiers.has(id),
  );
  if (unknownDisqualifiers.length > 0) {
    throw new Error(
      `Unknown disqualifier ids: ${unknownDisqualifiers.join(", ")}`,
    );
  }

  const criterionScores = profile.criteria.map((rule) =>
    scoreRule(rule, assessment.criteria[rule.id]),
  );
  const signalScores = profile.signals.map((rule) =>
    scoreRule(rule, assessment.signals[rule.id]),
  );
  const rules = [...criterionScores, ...signalScores];
  const possibleWeight = rules.reduce(
    (total, rule) => total + rule.possibleWeight,
    0,
  );
  const earnedWeight = rules.reduce(
    (total, rule) => total + rule.earnedWeight,
    0,
  );
  const rawScore =
    possibleWeight === 0 ? 1 : 1 + 4 * (earnedWeight / possibleWeight);
  const score = Math.round(rawScore * 100) / 100;

  const reasons: string[] = [];
  const missingRequired = profile.criteria.filter((rule) => {
    const result = criterionScores.find((item) => item.id === rule.id);
    return rule.required && (result?.matched !== true || !result.supported);
  });
  for (const rule of missingRequired) {
    reasons.push(`Required criterion not proven: ${rule.label}`);
  }

  const activeHardDisqualifiers = profile.disqualifiers.filter(
    (item) => item.hard && assessment.disqualifiers.includes(item.id),
  );
  for (const item of activeHardDisqualifiers) {
    reasons.push(`Hard disqualifier: ${item.label}`);
  }

  const rejected =
    missingRequired.length > 0 || activeHardDisqualifiers.length > 0;
  let status: ScoreStatus;
  if (rejected) {
    status = "reject";
  } else if (score >= profile.thresholds.action) {
    status = "action";
  } else if (score >= profile.thresholds.keep) {
    status = "keep";
  } else {
    status = "hold";
  }

  const geographyIndex = profile.geographyPriority.findIndex(
    (item) => item.toLowerCase() === assessment.geography.toLowerCase(),
  );

  return {
    opportunityId: assessment.opportunityId,
    score: rejected ? 1 : score,
    status,
    geographyRank:
      geographyIndex === -1 ? profile.geographyPriority.length : geographyIndex,
    reasons,
    rules,
  };
}
