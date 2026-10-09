import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  opportunityAssessmentSchema,
  scoutProfileSchema,
  type OpportunityAssessment,
  type ScoutProfile,
} from "../src/profiles/schema.js";
import { scoreOpportunity } from "../src/profiles/scorer.js";

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

describe("Scout profiles", () => {
  it.each(["sales-leads", "freelance", "jobs"])(
    "validates the %s starter profile",
    async (name) => {
      const profile = await readJson(`profiles/${name}.json`);
      expect(scoutProfileSchema.parse(profile).schemaVersion).toBe(1);
    },
  );

  it("rejects duplicate rule ids", async () => {
    const profile = scoutProfileSchema.parse(
      await readJson("profiles/freelance.json"),
    );
    expect(() =>
      scoutProfileSchema.parse({
        ...profile,
        signals: [{ ...profile.criteria[0] }],
      }),
    ).toThrow(/duplicate rule id/u);
  });
});

describe("opportunity scoring", () => {
  async function fixture(): Promise<{
    profile: ScoutProfile;
    assessment: OpportunityAssessment;
  }> {
    return {
      profile: scoutProfileSchema.parse(
        await readJson("profiles/freelance.json"),
      ),
      assessment: opportunityAssessmentSchema.parse(
        await readJson("examples/freelance-opportunity.json"),
      ),
    };
  }

  it("marks a fully supported match for action", async () => {
    const { profile, assessment } = await fixture();
    const result = scoreOpportunity(profile, assessment);
    expect(result).toMatchObject({
      score: 5,
      status: "action",
      geographyRank: 0,
    });
  });

  it("rejects a hard disqualifier", async () => {
    const { profile, assessment } = await fixture();
    const result = scoreOpportunity(profile, {
      ...assessment,
      disqualifiers: ["unpaid"],
    });
    expect(result.status).toBe("reject");
    expect(result.score).toBe(1);
  });

  it("rejects a required claim without evidence", async () => {
    const { profile, assessment } = await fixture();
    const skillFit = assessment.criteria.skill_fit;
    if (skillFit === undefined) {
      throw new Error("fixture is missing skill_fit");
    }
    const result = scoreOpportunity(profile, {
      ...assessment,
      criteria: {
        ...assessment.criteria,
        skill_fit: { ...skillFit, sources: [] },
      },
    });
    expect(result.status).toBe("reject");
    expect(result.reasons).toContain(
      "Required criterion not proven: Skill fit",
    );
  });

  it("keeps geography priority separate from fit", async () => {
    const { profile, assessment } = await fixture();
    const result = scoreOpportunity(profile, {
      ...assessment,
      geography: "Elsewhere",
    });
    expect(result.score).toBe(5);
    expect(result.geographyRank).toBe(profile.geographyPriority.length);
  });

  it("marks the representative global-remote SDE 2 role for action", async () => {
    const profile = scoutProfileSchema.parse(
      await readJson("profiles/jobs.json"),
    );
    const assessment = opportunityAssessmentSchema.parse(
      await readJson("examples/job-opportunity.json"),
    );

    expect(scoreOpportunity(profile, assessment)).toMatchObject({
      score: 5,
      status: "action",
      geographyRank: 1,
    });
  });
});
