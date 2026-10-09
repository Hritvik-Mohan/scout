import { z } from "zod";

import { fetchDiscoveryText, type FetchLike } from "../discovery/http.js";
import type {
  DiscoveredJob,
  JobDiscoveryAdapter,
  JobSearchRequest,
} from "./model.js";
import { stripMarkup } from "./text.js";

const leverCategoriesSchema = z
  .object({
    commitment: z.string().trim().optional(),
    department: z.string().trim().optional(),
    location: z.string().trim().optional(),
    team: z.string().trim().optional(),
    allLocations: z.array(z.string().trim()).optional(),
  })
  .passthrough();

const leverJobSchema = z
  .object({
    id: z.string().trim().min(1),
    text: z.string().trim().min(1),
    hostedUrl: z.string().url(),
    createdAt: z.number().int().nonnegative(),
    categories: leverCategoriesSchema.default({}),
    description: z.string().optional(),
    descriptionPlain: z.string().optional(),
    additional: z.string().optional(),
    additionalPlain: z.string().optional(),
    lists: z
      .array(
        z
          .object({
            text: z.string().default(""),
            content: z.string().default(""),
          })
          .passthrough(),
      )
      .default([]),
    workplaceType: z.string().trim().optional(),
  })
  .passthrough();

const leverResponseSchema = z.array(leverJobSchema);

export interface LeverAdapterOptions {
  site: string;
  company: string;
  fetch?: FetchLike;
}

export class LeverJobDiscoveryAdapter implements JobDiscoveryAdapter {
  readonly provider: string;
  private readonly site: string;
  private readonly company: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: LeverAdapterOptions) {
    this.site = options.site.trim();
    this.company = options.company.trim();
    this.fetchImpl = options.fetch ?? fetch;
    if (this.site === "" || this.company === "") {
      throw new Error("Lever site and company are required");
    }
    this.provider = `Lever: ${this.company}`;
  }

  async discover(request: JobSearchRequest): Promise<readonly DiscoveredJob[]> {
    if (!Number.isInteger(request.maxResults) || request.maxResults < 1) {
      throw new RangeError("maxResults must be a positive integer");
    }
    const url = new URL(
      `https://api.lever.co/v0/postings/${encodeURIComponent(this.site)}`,
    );
    url.searchParams.set("mode", "json");
    url.searchParams.set("limit", String(request.maxResults));
    const body = await fetchDiscoveryText(
      this.fetchImpl,
      url,
      "application/json",
    );
    const jobs = leverResponseSchema.parse(JSON.parse(body) as unknown);
    return jobs.slice(0, request.maxResults).map((job) => {
      const locations = job.categories.allLocations?.filter(Boolean) ?? [];
      const candidateLocation =
        locations.length > 0
          ? locations.join(", ")
          : (job.categories.location ?? "Unknown");
      const sections = job.lists
        .map((list) => `${list.text} ${list.content}`)
        .join(" ");
      const description = [
        job.descriptionPlain,
        job.description,
        sections,
        job.additionalPlain,
        job.additional,
      ]
        .filter((value): value is string => value !== undefined && value !== "")
        .join(" ");
      return {
        id: `lever:${this.site}:${job.id}`,
        provider: this.provider,
        title: job.text,
        company: this.company,
        url: job.hostedUrl,
        publishedAt: new Date(job.createdAt).toISOString(),
        candidateLocation,
        jobType: job.categories.commitment ?? null,
        salary: null,
        description: stripMarkup(description),
        tags: [
          job.categories.department,
          job.categories.team,
          job.workplaceType,
        ].filter(
          (value): value is string => value !== undefined && value !== "",
        ),
      };
    });
  }
}
