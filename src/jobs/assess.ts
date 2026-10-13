import type { DiscoveredJob } from "./model.js";
import { DEFAULT_JOB_SEARCH, type JobSearchConfig } from "./search-config.js";
import type {
  OpportunityAssessment,
  RuleAssessment,
} from "../profiles/schema.js";

const includesAny = (text: string, terms: readonly string[]): boolean =>
  terms.some((term) => text.includes(term));

const assessment = (
  matched: boolean | null,
  rationale: string,
  url: string,
): RuleAssessment => ({ matched, rationale, sources: [url] });

const minimumYears = (text: string): number | null => {
  const matches = [
    ...text.matchAll(
      /(?:at least|minimum|min\.?|requires?)\s+(\d+)\+?\s+(?:years|yrs)/gi,
    ),
    ...text.matchAll(/(\d+)\+\s+(?:years|yrs)/gi),
  ];
  const years = matches
    .map((match) => Number(match[1]))
    .filter((value) => Number.isInteger(value));
  return years.length === 0 ? null : Math.max(...years);
};

const LEVELS: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };

/** The numbered level in a title such as "SDE III" or "Engineer 2", else 0. */
const titleLevel = (title: string): number => {
  const levels = [
    ...title.matchAll(
      /\b(?:sde|engineer|developer)\s*(?:[-–—/]\s*)?(iii|ii|iv|i|v|[1-5])\b/giu,
    ),
  ].map((match) => {
    const raw = (match[1] ?? "").toLowerCase();
    return LEVELS[raw] ?? Number(raw);
  });
  return levels.length === 0 ? 0 : Math.max(...levels);
};

export interface AssessedJob {
  assessment: OpportunityAssessment;
  experienceRequired: string;
  techStack: readonly string[];
}

export function assessJob(
  job: DiscoveredJob,
  search: JobSearchConfig = DEFAULT_JOB_SEARCH,
): AssessedJob {
  const title = job.title.toLowerCase();
  const text =
    `${job.title} ${job.description} ${job.tags.join(" ")}`.toLowerCase();
  const location = job.candidateLocation.toLowerCase();
  const url = job.url;
  const roleMatch = includesAny(title, search.roleTitles);
  const nonDevelopment = includesAny(title, search.nonDevelopmentTitles);
  const specialistMismatch = includesAny(title, search.specialistTitles);
  const higherSdeLevel = titleLevel(title) > search.maxLevel;
  const tooSenior =
    higherSdeLevel || includesAny(title, search.tooSeniorTitles);
  const years = minimumYears(text);
  const technicalTerms = search.technicalTerms;
  const techStack = technicalTerms.filter((term) => text.includes(term));
  const technicalFit = techStack.length >= 2;
  const primaryLocationFit = includesAny(location, search.primaryLocations);
  const remoteSignal =
    job.provider === "Remotive" ||
    includesAny(text, ["remote", "work from home", "work-from-home"]);
  const remoteEligible = includesAny(location, search.remoteEligibleTerms);
  const remoteFit = remoteSignal && remoteEligible;
  const locationFit = primaryLocationFit || remoteFit;
  const disqualifiers: string[] = [];
  if (!locationFit) disqualifiers.push("work_authorization_mismatch");
  if (tooSenior || (years !== null && years >= search.hardMaxYears))
    disqualifiers.push("clearly_too_senior");
  if (nonDevelopment) disqualifiers.push("non_development_role");
  if (specialistMismatch) disqualifiers.push("specialization_mismatch");

  const qualityMatch = includesAny(text, [
    "test",
    "code review",
    "observability",
    "tracing",
    "ci/cd",
    "continuous integration",
    "slo",
  ]);
  const systemsMatch = includesAny(text, search.systemsTerms);
  const platformMatch = includesAny(text, search.platformTerms);
  const experienceRequired =
    years === null
      ? "Not explicitly stated - verify"
      : `${String(years)}+ years`;
  return {
    assessment: {
      opportunityId: job.id,
      title: job.title,
      sourceUrl: job.url,
      geography: primaryLocationFit
        ? search.primaryLocationLabel
        : search.remoteLabel,
      criteria: {
        role_family_fit: assessment(
          roleMatch && !nonDevelopment,
          roleMatch
            ? "The title matches the configured software-engineering role family."
            : "The title does not clearly match the configured role family.",
          url,
        ),
        technical_domain_fit: assessment(
          technicalFit,
          technicalFit
            ? `The description contains relevant backend or systems signals: ${techStack.slice(0, 6).join(", ")}.`
            : "The description lacks enough backend or distributed-systems evidence.",
          url,
        ),
        seniority_fit: assessment(
          !tooSenior &&
            !(
              title.includes("senior") &&
              years !== null &&
              years >= search.maxYears
            ) &&
            (years === null || years <= search.maxYears),
          tooSenior
            ? "The title indicates staff-level, architecture, or management scope."
            : years === null
              ? "No firm senior-only experience minimum was detected; manual verification remains advisable."
              : `The detected minimum is ${String(years)} years.`,
          url,
        ),
        location_and_authorization_fit: assessment(
          locationFit,
          `${job.provider} lists the candidate location as ${job.candidateLocation}.`,
          url,
        ),
        language_and_stack_fit: assessment(
          techStack.length > 0,
          techStack.length > 0
            ? `Detected relevant stack terms: ${techStack.slice(0, 8).join(", ")}.`
            : "No preferred stack terms were detected.",
          url,
        ),
        ownership_and_impact: assessment(
          includesAny(text, [
            "own",
            "ownership",
            "design",
            "architecture",
            "build",
            "develop",
          ]),
          "Ownership is inferred only from explicit build, design, architecture, or ownership language.",
          url,
        ),
        engineering_quality: assessment(
          qualityMatch,
          qualityMatch
            ? "The description includes engineering-quality practices."
            : "Engineering-quality practices were not explicit.",
          url,
        ),
        growth_environment: assessment(
          includesAny(text, [
            "mentor",
            "mentorship",
            "growth",
            "learning",
            "career",
          ]),
          "Growth fit is based on explicit mentorship, learning, or career language.",
          url,
        ),
        compensation_quality: assessment(
          job.salary !== null,
          job.salary === null
            ? "Compensation is not published."
            : `Published compensation: ${job.salary}.`,
          url,
        ),
      },
      signals: {
        verified_current_opening: assessment(
          true,
          `The role was returned by ${job.provider}'s active-jobs feed.`,
          url,
        ),
        preferred_systems_overlap: assessment(
          systemsMatch,
          systemsMatch
            ? "The description includes preferred systems concepts."
            : "Preferred systems concepts were not explicit.",
          url,
        ),
        preferred_platform_overlap: assessment(
          platformMatch,
          platformMatch
            ? "The description includes preferred platform technologies."
            : "Preferred platform technologies were not explicit.",
          url,
        ),
        referral_path: assessment(
          false,
          "No referral contact has been researched yet.",
          url,
        ),
        remote_employment_clarity: assessment(
          locationFit && job.jobType !== null,
          `Listed location is ${job.candidateLocation}; job type is ${job.jobType ?? "not stated"}. Employment mechanism and timezone still require verification.`,
          url,
        ),
      },
      disqualifiers,
    },
    experienceRequired,
    techStack,
  };
}
