import { z } from "zod";

import { fetchDiscoveryText, type FetchLike } from "../discovery/http.js";
import type {
  DiscoveredJob,
  JobDiscoveryAdapter,
  JobSearchRequest,
} from "./model.js";
import { stripMarkup } from "./text.js";

const REMOTIVE_ENDPOINT = "https://remotive.com/api/remote-jobs";

const remotiveJobSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    url: z.string().url(),
    title: z.string().trim().min(1),
    company_name: z.string().trim().min(1),
    publication_date: z.string().trim().min(1),
    candidate_required_location: z.string().trim().default("Unknown"),
    job_type: z.string().trim().min(1).nullable().optional(),
    salary: z.string().trim().nullable().optional(),
    description: z.string().default(""),
    tags: z.array(z.string()).default([]),
  })
  .passthrough();

const responseSchema = z
  .object({ jobs: z.array(remotiveJobSchema) })
  .passthrough();

export class RemotiveJobDiscoveryAdapter implements JobDiscoveryAdapter {
  readonly provider = "Remotive";

  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async discover(request: JobSearchRequest): Promise<readonly DiscoveredJob[]> {
    if (
      Number.isNaN(request.startAt.valueOf()) ||
      Number.isNaN(request.endAt.valueOf()) ||
      request.startAt >= request.endAt
    ) {
      throw new RangeError("job discovery requires a valid date window");
    }
    if (!Number.isInteger(request.maxResults) || request.maxResults < 1) {
      throw new RangeError("maxResults must be a positive integer");
    }
    const url = new URL(REMOTIVE_ENDPOINT);
    url.searchParams.set("category", "software-dev");
    url.searchParams.set("limit", String(Math.min(request.maxResults, 100)));
    const body = await fetchDiscoveryText(
      this.fetchImpl,
      url,
      "application/json",
    );
    const parsed = responseSchema.parse(JSON.parse(body) as unknown);
    return parsed.jobs.flatMap((job) => {
      const publishedAt = new Date(job.publication_date);
      if (
        Number.isNaN(publishedAt.valueOf()) ||
        publishedAt < request.startAt ||
        publishedAt > request.endAt
      ) {
        return [];
      }
      return [
        {
          id: `remotive:${String(job.id)}`,
          provider: this.provider,
          title: job.title,
          company: job.company_name,
          url: job.url,
          publishedAt: publishedAt.toISOString(),
          candidateLocation: job.candidate_required_location,
          jobType: job.job_type ?? null,
          salary:
            job.salary === undefined || job.salary === "" ? null : job.salary,
          description: stripMarkup(job.description),
          tags: job.tags,
        },
      ];
    });
  }
}
