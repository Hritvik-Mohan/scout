import type { FetchLike } from "../discovery/http.js";
import type { ScoutProfile } from "../profiles/schema.js";
import { scoreOpportunity } from "../profiles/scorer.js";
import { assessJob } from "./assess.js";
import type { JobSearchRequest } from "./model.js";
import { DEFAULT_JOB_SEARCH, type JobSearchConfig } from "./search-config.js";
import {
  createJobDiscoveryAdapter,
  type ConfiguredJobSource,
} from "./sources.js";

export type DetectableBoardType = "greenhouse" | "lever" | "ashby";

export interface DetectedBoard {
  type: DetectableBoardType;
  slug: string;
  url: string;
  keptRoles: number;
}

const BOARD_URLS: Record<DetectableBoardType, (slug: string) => string> = {
  greenhouse: (slug) =>
    `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
  lever: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
  ashby: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
};

const LEGAL_SUFFIXES =
  /\b(?:pvt|private|ltd|limited|inc|llp|llc|technologies|technology|tech|labs|software|solutions|systems|global|india|ai|io|hq|app)\b\.?/gu;

/**
 * Board identifiers a company would plausibly use, derived only from its name.
 * Short or generic names are skipped because they collide with other firms.
 */
export function boardSlugCandidates(companyName: string): readonly string[] {
  const words = (value: string): string[] =>
    value
      .toLowerCase()
      .replace(/\([^)]*\)/gu, " ")
      .replace(/[^a-z0-9]+/gu, " ")
      .trim()
      .split(" ")
      .filter(Boolean);
  const full = words(companyName);
  const trimmed = words(companyName.toLowerCase().replace(LEGAL_SUFFIXES, " "));
  const candidates = new Set<string>();
  for (const parts of [full, trimmed]) {
    if (parts.length === 0) continue;
    candidates.add(parts.join(""));
    candidates.add(parts.join("-"));
  }
  return [...candidates].filter((slug) => slug.length >= 4);
}

/**
 * Probes the public Greenhouse, Lever and Ashby feeds for a company. A board
 * counts only when it has at least one role the profile would keep and the
 * posting text names the company, which guards against identifier collisions.
 */
export async function detectCompanyBoards(
  companyName: string,
  profile: ScoutProfile,
  request: JobSearchRequest,
  fetchImpl: FetchLike = fetch,
  search: JobSearchConfig = DEFAULT_JOB_SEARCH,
): Promise<readonly DetectedBoard[]> {
  // Compare on letters and digits only so "Hevo Data" matches "HevoData.com".
  const compact = (value: string): string =>
    value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
  const needle = compact(
    companyName
      .toLowerCase()
      .replace(/\([^)]*\)/gu, " ")
      .replace(LEGAL_SUFFIXES, " "),
  );
  const detected: DetectedBoard[] = [];
  for (const type of ["greenhouse", "lever", "ashby"] as const) {
    for (const slug of boardSlugCandidates(companyName)) {
      const source: ConfiguredJobSource = {
        id: `${type}-${slug}`,
        name: companyName,
        type,
        url: BOARD_URLS[type](slug),
        rowNumber: 0,
      };
      try {
        const jobs = await createJobDiscoveryAdapter(
          source,
          fetchImpl,
          search,
        ).discover(request);
        const kept = jobs.filter((job) => {
          const status = scoreOpportunity(
            profile,
            assessJob(job, search).assessment,
          ).status;
          return status === "keep" || status === "action";
        });
        const namesCompany = kept.some((job) =>
          compact(`${job.description} ${job.url}`).includes(needle),
        );
        if (kept.length > 0 && needle.length >= 4 && namesCompany) {
          detected.push({
            type,
            slug,
            url: source.url,
            keptRoles: kept.length,
          });
          break;
        }
      } catch {
        // A missing board is the normal case, and one bad feed must not stop
        // the sweep, so every failure counts as "not detected".
      }
    }
  }
  return detected;
}
