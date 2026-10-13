import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { SEARCH_DIRECTORY } from "./search-paths.js";

export interface SearchRepoState {
  /** True when my-search/ is its own Git repository. */
  isRepo: boolean;
  /** Files changed since the last commit. */
  dirty: boolean;
  /** Commits not yet pushed to the remote. */
  ahead: number;
  hasRemote: boolean;
}

const git = (directory: string, args: readonly string[]): string =>
  execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

/** Reads the state of the private search repository without changing it. */
export function readSearchRepoState(
  directory: string = resolve(SEARCH_DIRECTORY),
): SearchRepoState {
  if (!existsSync(resolve(directory, ".git"))) {
    return { isRepo: false, dirty: false, ahead: 0, hasRemote: false };
  }
  const dirty = git(directory, ["status", "--porcelain"]) !== "";
  const hasRemote = git(directory, ["remote"]) !== "";
  const count = (range: string): number => {
    try {
      return Number(git(directory, ["rev-list", "--count", range]));
    } catch {
      return -1;
    }
  };
  // Without an upstream every local commit is unpushed; a repository with no
  // commits at all has nothing to push.
  const tracked = count("@{u}..HEAD");
  const ahead =
    tracked >= 0 ? tracked : hasRemote ? Math.max(count("HEAD"), 0) : 0;
  return { isRepo: true, dirty, ahead, hasRemote };
}

/**
 * A one-line warning when edits to the search have not reached the private
 * repository, since cloud runs read the pushed version. Null when in sync.
 */
export function searchRepoWarning(state: SearchRepoState): string | null {
  if (!state.isRepo || !state.hasRemote) return null;
  if (!state.dirty && state.ahead === 0) return null;
  const what = state.dirty
    ? "has changes that are not committed"
    : `has ${String(state.ahead)} commit(s) that are not pushed`;
  return `${SEARCH_DIRECTORY}/ ${what}; cloud runs still use the old version. Run: npm run jobs:search:sync`;
}

/** Commits any changes in the search repository and pushes them. */
export function syncSearchRepo(
  directory: string = resolve(SEARCH_DIRECTORY),
  message = "Update search files",
): { committed: boolean; pushed: boolean; state: SearchRepoState } {
  const before = readSearchRepoState(directory);
  if (!before.isRepo) {
    throw new Error(
      `${SEARCH_DIRECTORY}/ is not a Git repository. See "Keep your search in a private repository" in the README.`,
    );
  }
  if (!before.hasRemote) {
    throw new Error(
      `${SEARCH_DIRECTORY}/ has no remote. Add your private repository as "origin" first.`,
    );
  }
  if (before.dirty) {
    git(directory, ["add", "-A"]);
    git(directory, ["commit", "-m", message]);
  }
  const pending = readSearchRepoState(directory);
  if (pending.ahead > 0) git(directory, ["push", "-u", "origin", "HEAD"]);
  return {
    committed: before.dirty,
    pushed: pending.ahead > 0,
    state: readSearchRepoState(directory),
  };
}
