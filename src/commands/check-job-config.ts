import { access } from "node:fs/promises";

import { loadJobSearchConfig } from "../jobs/search-config.js";
import { requireSearchFile, searchPaths } from "../jobs/search-paths.js";
import { loadScoutProfile } from "../profiles/loader.js";

// The assessor reports against these rule ids, so a profile must define them.
const REQUIRED_CRITERIA = [
  "role_family_fit",
  "technical_domain_fit",
  "seniority_fit",
  "location_and_authorization_fit",
];

const paths = searchPaths();
const profilePath = await requireSearchFile(paths.profile);
const searchPath = await requireSearchFile(paths.search);
const icpPath = paths.icp;
const profile = await loadScoutProfile(profilePath);
const search = await loadJobSearchConfig(searchPath);
const problems: string[] = [];
if (profile.purpose !== "jobs") {
  problems.push(`${profilePath}: purpose must be "jobs"`);
}
const criteria = new Set(profile.criteria.map((rule) => rule.id));
for (const id of REQUIRED_CRITERIA) {
  if (!criteria.has(id))
    problems.push(`${profilePath}: missing criterion ${id}`);
}
const geographies = profile.geographyPriority.map((item) => item.toLowerCase());
for (const label of [search.primaryLocationLabel, search.remoteLabel]) {
  if (!geographies.includes(label.toLowerCase())) {
    problems.push(
      `${searchPath}: "${label}" is not listed in geographyPriority of ${profilePath}`,
    );
  }
}
if (search.maxYears >= search.hardMaxYears) {
  problems.push(`${searchPath}: maxYears must be below hardMaxYears`);
}
await access(icpPath).catch(() => {
  problems.push(
    `${icpPath}: missing; reviews read the candidate facts from it`,
  );
});
process.stdout.write(
  `${JSON.stringify({ profile: profile.id, roleTitles: search.roleTitles.length, locations: search.primaryLocations, remote: search.remoteEligibleTerms, problems }, null, 2)}\n`,
);
if (problems.length > 0) process.exitCode = 1;
