import { z } from "zod";

import { fetchDiscoveryText, type FetchLike } from "../discovery/http.js";
import type {
  DiscoveredJob,
  JobDiscoveryAdapter,
  JobSearchRequest,
} from "./model.js";
import { stripMarkup } from "./text.js";

const ashbyJobSchema = z
  .object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    jobUrl: z.string().url(),
    publishedAt: z.string().trim().min(1),
    location: z.string().trim().default("Unknown"),
    descriptionPlain: z.string().default(""),
    department: z.string().trim().nullish(),
    team: z.string().trim().nullish(),
    employmentType: z.string().trim().nullish(),
    workplaceType: z.string().trim().nullish(),
    isRemote: z.boolean().nullish(),
  })
  .passthrough();

const ashbyResponseSchema = z
  .object({ jobs: z.array(ashbyJobSchema) })
  .passthrough();

export interface AshbyAdapterOptions {
  boardName: string;
  company: string;
  fetch?: FetchLike;
}

export class AshbyJobDiscoveryAdapter implements JobDiscoveryAdapter {
  readonly provider: string;
  private readonly boardName: string;
  private readonly company: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: AshbyAdapterOptions) {
    this.boardName = options.boardName.trim();
    this.company = options.company.trim();
    this.fetchImpl = options.fetch ?? fetch;
    if (this.boardName === "" || this.company === "") {
      throw new Error("Ashby board name and company are required");
    }
    this.provider = `Ashby: ${this.company}`;
  }

  async discover(request: JobSearchRequest): Promise<readonly DiscoveredJob[]> {
    if (!Number.isInteger(request.maxResults) || request.maxResults < 1) {
      throw new RangeError("maxResults must be a positive integer");
    }
    const url = new URL(
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(this.boardName)}`,
    );
    const body = await fetchDiscoveryText(
      this.fetchImpl,
      url,
      "application/json",
    );
    const parsed = ashbyResponseSchema.parse(JSON.parse(body) as unknown);
    return parsed.jobs.slice(0, request.maxResults).map((job) => ({
      id: `ashby:${this.boardName}:${job.id}`,
      provider: this.provider,
      title: job.title,
      company: this.company,
      url: job.jobUrl,
      publishedAt: new Date(job.publishedAt).toISOString(),
      candidateLocation: job.location,
      jobType: job.employmentType ?? null,
      salary: null,
      description: stripMarkup(job.descriptionPlain),
      tags: [
        job.department,
        job.team,
        job.workplaceType,
        job.isRemote === true ? "Remote" : undefined,
      ].filter(
        (value): value is string =>
          value !== undefined && value !== null && value !== "",
      ),
    }));
  }
}
