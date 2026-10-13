import { access } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * A person's search lives in my-search/, which Git ignores, so their profile
 * never collides with upstream changes or ends up in a shared repository.
 */
export const SEARCH_DIRECTORY = "my-search";

export interface SearchPaths {
  profile: string;
  search: string;
  icp: string;
}

export function searchPaths(env: NodeJS.ProcessEnv = process.env): SearchPaths {
  return {
    profile: resolve(env.SCOUT_PROFILE_PATH ?? `${SEARCH_DIRECTORY}/jobs.json`),
    search: resolve(
      env.SCOUT_JOB_SEARCH_PATH ?? `${SEARCH_DIRECTORY}/job-search.json`,
    ),
    icp: resolve(env.SCOUT_ICP_PATH ?? `${SEARCH_DIRECTORY}/job-search-icp.md`),
  };
}

/** Fails with setup guidance when a search file has not been created yet. */
export async function requireSearchFile(path: string): Promise<string> {
  try {
    await access(path);
  } catch {
    throw new Error(
      `${path} not found. Create your search first: cp -R examples/john-doe ${SEARCH_DIRECTORY}, then edit the files (see README).`,
    );
  }
  return path;
}
