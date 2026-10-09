import { z } from "zod";

import { fetchDiscoveryText, type FetchLike } from "../discovery/http.js";
import type {
  DiscoveredJob,
  JobDiscoveryAdapter,
  JobSearchRequest,
} from "./model.js";
import { stripMarkup } from "./text.js";

const greenhouseJobSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    title: z.string().trim().min(1),
    absolute_url: z.string().url(),
    updated_at: z.string().trim().min(1),
    location: z.object({ name: z.string().trim().default("Unknown") }),
    content: z.string().default(""),
    departments: z
      .array(z.object({ name: z.string().trim().min(1) }).passthrough())
      .default([]),
    offices: z
      .array(z.object({ name: z.string().trim().min(1) }).passthrough())
      .default([]),
  })
  .passthrough();

const greenhouseResponseSchema = z
  .object({ jobs: z.array(greenhouseJobSchema) })
  .passthrough();

const includesAny = (value: string, terms: readonly string[]): boolean =>
  terms.some((term) => value.includes(term));

const isPotentialCandidate = (
  job: z.infer<typeof greenhouseJobSchema>,
): boolean => {
  const title = job.title.toLowerCase();
  const location = job.location.name.toLowerCase();
  return (
    includesAny(title, [
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
    ]) &&
    includesAny(location, [
      "worldwide",
      "anywhere",
      "global",
      "india",
      "bengaluru",
      "bangalore",
    ])
  );
};

export interface GreenhouseAdapterOptions {
  boardToken: string;
  company: string;
  fetch?: FetchLike;
}

export class GreenhouseJobDiscoveryAdapter implements JobDiscoveryAdapter {
  readonly provider: string;
  private readonly boardToken: string;
  private readonly company: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: GreenhouseAdapterOptions) {
    this.boardToken = options.boardToken.trim();
    this.company = options.company.trim();
    this.fetchImpl = options.fetch ?? fetch;
    if (this.boardToken === "" || this.company === "") {
      throw new Error("Greenhouse board token and company are required");
    }
    this.provider = `Greenhouse: ${this.company}`;
  }

  async discover(request: JobSearchRequest): Promise<readonly DiscoveredJob[]> {
    if (!Number.isInteger(request.maxResults) || request.maxResults < 1) {
      throw new RangeError("maxResults must be a positive integer");
    }
    const url = new URL(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(this.boardToken)}/jobs`,
    );
    const body = await fetchDiscoveryText(
      this.fetchImpl,
      url,
      "application/json",
    );
    const parsed = greenhouseResponseSchema.parse(JSON.parse(body) as unknown);
    const candidates = parsed.jobs
      .filter(isPotentialCandidate)
      .slice(0, request.maxResults);
    const detailedJobs = await Promise.all(
      candidates.map(async (job) => {
        const detailUrl = new URL(
          `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(this.boardToken)}/jobs/${encodeURIComponent(String(job.id))}`,
        );
        const detailBody = await fetchDiscoveryText(
          this.fetchImpl,
          detailUrl,
          "application/json",
        );
        return greenhouseJobSchema.parse(JSON.parse(detailBody) as unknown);
      }),
    );
    return detailedJobs.map((job) => ({
      id: `greenhouse:${this.boardToken}:${String(job.id)}`,
      provider: this.provider,
      title: job.title,
      company: this.company,
      url: job.absolute_url,
      publishedAt: new Date(job.updated_at).toISOString(),
      candidateLocation:
        job.location.name ||
        job.offices.map((office) => office.name).join(", ") ||
        "Unknown",
      jobType: null,
      salary: null,
      description: stripMarkup(job.content),
      tags: [
        ...job.departments.map((department) => department.name),
        ...job.offices.map((office) => office.name),
      ],
    }));
  }
}
