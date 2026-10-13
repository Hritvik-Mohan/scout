import { readFile } from "node:fs/promises";

import { z } from "zod";

// Not trimmed: a leading or trailing space is a deliberate word boundary.
const terms = z.array(z.string().min(1).toLowerCase()).min(1);

/**
 * What one candidate is looking for, in the matching terms the keyword
 * assessor uses. It lives in a JSON file so the engine can serve any search:
 * change the titles, stack, locations and experience ceiling, not the code.
 * Every term is matched as a lowercase substring.
 */
export const jobSearchConfigSchema = z
  .object({
    /** A title must contain one of these to count as a target role. */
    roleTitles: terms,
    /** Titles that are not software-development roles. */
    nonDevelopmentTitles: terms,
    /** Titles in a specialism the candidate is not targeting. */
    specialistTitles: terms,
    /** Title fragments that mean the role is too senior. */
    tooSeniorTitles: terms,
    /** Highest numbered level to keep: 2 keeps "SDE II" and drops "SDE III". */
    maxLevel: z.number().int().min(1).max(5),
    /** Stack and domain words; two or more in a posting prove technical fit. */
    technicalTerms: terms,
    systemsTerms: terms,
    platformTerms: terms,
    /** Cities the candidate will work in, matched against the job location. */
    primaryLocations: terms,
    /** Must equal an entry in the profile's geographyPriority. */
    primaryLocationLabel: z.string().trim().min(1),
    /** Location words that make a remote role open to the candidate. */
    remoteEligibleTerms: terms,
    /** Must equal an entry in the profile's geographyPriority. */
    remoteLabel: z.string().trim().min(1),
    /** Years of experience above which a role stops being a fit. */
    maxYears: z.number().int().min(0),
    /** Years of experience at which a role is rejected outright. */
    hardMaxYears: z.number().int().min(1),
  })
  .strict();

export type JobSearchConfig = z.infer<typeof jobSearchConfigSchema>;

export async function loadJobSearchConfig(
  path: string,
): Promise<JobSearchConfig> {
  return jobSearchConfigSchema.parse(
    JSON.parse(await readFile(path, "utf8")) as unknown,
  );
}

/** The search used when no file is supplied; mirrors profiles/job-search.json. */
export const DEFAULT_JOB_SEARCH: JobSearchConfig = jobSearchConfigSchema.parse({
  roleTitles: [
    "software engineer",
    "software developer",
    "sde",
    "backend",
    "back-end",
    "platform engineer",
    "infrastructure engineer",
    "distributed systems",
    "product engineer",
    "full stack",
    "full-stack",
    "api engineer",
    "developer tools",
  ],
  nonDevelopmentTitles: [
    "quality assurance",
    " qa ",
    "support engineer",
    "l3 support",
    "sdet",
    "engineer in test",
    "sales engineer",
    "data scientist",
    "product manager",
    "designer",
    "recruiter",
    "code trainer",
    "ai trainer",
    "code evaluator",
    "data annotator",
  ],
  specialistTitles: [
    "frontend",
    "front-end",
    "ios",
    "android",
    "mobile engineer",
    "machine learning researcher",
    "security researcher",
    "embedded",
    "firmware",
  ],
  tooSeniorTitles: [
    "staff ",
    "principal",
    "director",
    "head of",
    "engineering manager",
    "manager,",
    "manager -",
    "manager of",
    "lead engineer",
    "architect",
  ],
  maxLevel: 2,
  technicalTerms: [
    "backend",
    "back-end",
    "distributed",
    "microservice",
    "node.js",
    "nodejs",
    "typescript",
    "javascript",
    "java",
    "c++",
    "api",
    "websocket",
    "queue",
    "aws",
    "docker",
    "observability",
    "reliability",
    "platform",
  ],
  systemsTerms: [
    "distributed",
    "microservice",
    "high availability",
    "fault tolerance",
    "load balancing",
    "rate limit",
    "queue",
    "observability",
    "latency",
    "performance",
  ],
  platformTerms: [
    "typescript",
    "node.js",
    "nodejs",
    "rest api",
    "websocket",
    "aws",
    "docker",
    "developer tool",
    "infrastructure",
  ],
  primaryLocations: ["bangalore", "bengaluru"],
  primaryLocationLabel: "Bengaluru",
  remoteEligibleTerms: ["worldwide", "anywhere", "global", "india"],
  remoteLabel: "Remote (India-compatible)",
  maxYears: 5,
  hardMaxYears: 7,
});
