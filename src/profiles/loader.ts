import { readFile } from "node:fs/promises";

import {
  opportunityAssessmentSchema,
  scoutProfileSchema,
  type OpportunityAssessment,
  type ScoutProfile,
} from "./schema.js";

async function readJson(path: string): Promise<unknown> {
  const source = await readFile(path, "utf8");
  return JSON.parse(source) as unknown;
}

export async function loadScoutProfile(path: string): Promise<ScoutProfile> {
  return scoutProfileSchema.parse(await readJson(path));
}

export async function loadOpportunityAssessment(
  path: string,
): Promise<OpportunityAssessment> {
  return opportunityAssessmentSchema.parse(await readJson(path));
}
