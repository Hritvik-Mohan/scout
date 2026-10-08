import { resolve } from "node:path";

import {
  loadOpportunityAssessment,
  loadScoutProfile,
} from "../profiles/loader.js";
import { scoreOpportunity } from "../profiles/scorer.js";

const profilePath = process.argv[2];
const assessmentPath = process.argv[3];
if (profilePath === undefined || assessmentPath === undefined) {
  throw new Error(
    "Usage: npm run profile:score -- <profile.json> <assessment.json>",
  );
}

const [profile, assessment] = await Promise.all([
  loadScoutProfile(resolve(profilePath)),
  loadOpportunityAssessment(resolve(assessmentPath)),
]);
process.stdout.write(
  `${JSON.stringify(scoreOpportunity(profile, assessment), null, 2)}\n`,
);
