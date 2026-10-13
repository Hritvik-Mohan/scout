import type { FetchLike } from "../discovery/http.js";
import { AshbyJobDiscoveryAdapter } from "./ashby.js";
import { GreenhouseJobDiscoveryAdapter } from "./greenhouse.js";
import { LeverJobDiscoveryAdapter } from "./lever.js";
import type { JobDiscoveryAdapter } from "./model.js";
import { RemotiveJobDiscoveryAdapter } from "./remotive.js";
import { DEFAULT_JOB_SEARCH, type JobSearchConfig } from "./search-config.js";
import { SmartRecruitersJobDiscoveryAdapter } from "./smartrecruiters.js";

export interface ConfiguredJobSource {
  id: string;
  name: string;
  type: "remotive" | "greenhouse" | "lever" | "smartrecruiters" | "ashby";
  url: string;
  rowNumber: number;
}

const text = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  return "";
};

const isActive = (value: unknown): boolean =>
  value === true || ["true", "yes", "1"].includes(text(value).toLowerCase());

export function parseConfiguredJobSources(
  rows: readonly (readonly unknown[])[],
): readonly ConfiguredJobSource[] {
  return rows.flatMap((row, index) => {
    const id = text(row[0]);
    const name = text(row[1]);
    const type = text(row[2]).toLowerCase();
    const url = text(row[3]);
    if (
      id === "" ||
      name === "" ||
      url === "" ||
      !isActive(row[5]) ||
      !["remotive", "greenhouse", "lever", "smartrecruiters", "ashby"].includes(
        type,
      )
    ) {
      return [];
    }
    return [
      {
        id,
        name,
        type: type as ConfiguredJobSource["type"],
        url,
        rowNumber: index + 2,
      },
    ];
  });
}

const requiredSegmentAfter = (url: URL, segment: string): string => {
  const parts = url.pathname.split("/").filter(Boolean);
  const index = parts.indexOf(segment);
  const value = index < 0 ? undefined : parts[index + 1];
  if (value === undefined || value === "") {
    throw new Error(`Source URL is missing ${segment} identifier`);
  }
  return decodeURIComponent(value);
};

/**
 * The opportunity-ID prefix for roles from a source whose feed lists every open
 * posting, or null when a role's absence from the feed proves nothing (Remotive
 * is a rolling feed; SmartRecruiters returns one filtered page).
 */
export function completeFeedIdPrefix(
  source: ConfiguredJobSource,
): string | null {
  const url = new URL(source.url);
  if (source.type === "greenhouse") {
    return `greenhouse:${requiredSegmentAfter(url, "boards")}:`;
  }
  if (source.type === "lever") {
    return `lever:${requiredSegmentAfter(url, "postings")}:`;
  }
  if (source.type === "ashby") {
    return `ashby:${requiredSegmentAfter(url, "job-board")}:`;
  }
  return null;
}

export function createJobDiscoveryAdapter(
  source: ConfiguredJobSource,
  fetchImpl: FetchLike = fetch,
  search: JobSearchConfig = DEFAULT_JOB_SEARCH,
): JobDiscoveryAdapter {
  const url = new URL(source.url);
  if (source.type === "remotive") {
    if (url.hostname !== "remotive.com") {
      throw new Error("Remotive source must use remotive.com");
    }
    return new RemotiveJobDiscoveryAdapter(fetchImpl);
  }
  if (source.type === "greenhouse") {
    if (url.hostname !== "boards-api.greenhouse.io") {
      throw new Error("Greenhouse source must use boards-api.greenhouse.io");
    }
    return new GreenhouseJobDiscoveryAdapter({
      boardToken: requiredSegmentAfter(url, "boards"),
      company: source.name,
      fetch: fetchImpl,
      search,
    });
  }
  if (source.type === "smartrecruiters") {
    if (url.hostname !== "api.smartrecruiters.com") {
      throw new Error(
        "SmartRecruiters source must use api.smartrecruiters.com",
      );
    }
    return new SmartRecruitersJobDiscoveryAdapter({
      companyIdentifier: requiredSegmentAfter(url, "companies"),
      company: source.name,
      fetch: fetchImpl,
    });
  }
  if (source.type === "ashby") {
    if (url.hostname !== "api.ashbyhq.com") {
      throw new Error("Ashby source must use api.ashbyhq.com");
    }
    return new AshbyJobDiscoveryAdapter({
      boardName: requiredSegmentAfter(url, "job-board"),
      company: source.name,
      fetch: fetchImpl,
    });
  }
  if (url.hostname !== "api.lever.co") {
    throw new Error("Lever source must use api.lever.co");
  }
  return new LeverJobDiscoveryAdapter({
    site: requiredSegmentAfter(url, "postings"),
    company: source.name,
    fetch: fetchImpl,
  });
}
