import { z } from "zod";

import { fetchDiscoveryText, type FetchLike } from "../discovery/http.js";
import type {
  DiscoveredJob,
  JobDiscoveryAdapter,
  JobSearchRequest,
} from "./model.js";
import { stripMarkup } from "./text.js";

const labelledSchema = z
  .object({ label: z.string().trim().optional() })
  .passthrough();

const locationSchema = z
  .object({
    city: z.string().trim().optional(),
    region: z.string().trim().optional(),
    country: z.string().trim().optional(),
    remote: z.boolean().optional(),
  })
  .passthrough();

const postingSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    uuid: z.string().trim().optional(),
    name: z.string().trim().min(1),
    releasedDate: z.string().trim().min(1),
    postingUrl: z.string().url().optional(),
    applyUrl: z.string().url().optional(),
    location: locationSchema.default({}),
    company: z
      .object({
        identifier: z.string().trim().optional(),
        name: z.string().trim().optional(),
      })
      .passthrough()
      .optional(),
    department: labelledSchema.optional(),
    function: labelledSchema.optional(),
    experienceLevel: labelledSchema.optional(),
    typeOfEmployment: labelledSchema.optional(),
    jobAd: z
      .object({
        sections: z.record(z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const listingSchema = z
  .object({ content: z.array(postingSchema).default([]) })
  .passthrough();

const candidateTitle = (title: string): boolean =>
  [
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
  ].some((term) => title.toLowerCase().includes(term));

const flattenStrings = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(flattenStrings);
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(flattenStrings);
  }
  return [];
};

export interface SmartRecruitersAdapterOptions {
  companyIdentifier: string;
  company: string;
  fetch?: FetchLike;
}

export class SmartRecruitersJobDiscoveryAdapter implements JobDiscoveryAdapter {
  readonly provider: string;
  private readonly companyIdentifier: string;
  private readonly company: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: SmartRecruitersAdapterOptions) {
    this.companyIdentifier = options.companyIdentifier.trim();
    this.company = options.company.trim();
    this.fetchImpl = options.fetch ?? fetch;
    if (this.companyIdentifier === "" || this.company === "") {
      throw new Error(
        "SmartRecruiters company identifier and name are required",
      );
    }
    this.provider = `SmartRecruiters: ${this.company}`;
  }

  async discover(request: JobSearchRequest): Promise<readonly DiscoveredJob[]> {
    if (!Number.isInteger(request.maxResults) || request.maxResults < 1) {
      throw new RangeError("maxResults must be a positive integer");
    }
    const listUrl = new URL(
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(this.companyIdentifier)}/postings`,
    );
    listUrl.searchParams.set(
      "limit",
      String(Math.min(request.maxResults, 100)),
    );
    listUrl.searchParams.set("destination", "PUBLIC");
    const listBody = await fetchDiscoveryText(
      this.fetchImpl,
      listUrl,
      "application/json",
    );
    const listed = listingSchema.parse(JSON.parse(listBody) as unknown).content;
    const candidates = listed
      .filter((posting) => candidateTitle(posting.name))
      .slice(0, request.maxResults);
    const detailed = await Promise.all(
      candidates.map(async (posting) => {
        const detailUrl = new URL(
          `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(this.companyIdentifier)}/postings/${encodeURIComponent(String(posting.id))}`,
        );
        const detailBody = await fetchDiscoveryText(
          this.fetchImpl,
          detailUrl,
          "application/json",
        );
        return postingSchema.parse(JSON.parse(detailBody) as unknown);
      }),
    );
    return detailed.map((posting) => {
      const location = [
        posting.location.city,
        posting.location.region,
        posting.location.country,
        posting.location.remote ? "Remote" : undefined,
      ]
        .filter((value): value is string => value !== undefined && value !== "")
        .join(", ");
      const description = flattenStrings(posting.jobAd?.sections).join(" ");
      return {
        id: `smartrecruiters:${this.companyIdentifier}:${String(posting.id)}`,
        provider: this.provider,
        title: posting.name,
        company: posting.company?.name ?? this.company,
        url:
          posting.postingUrl ??
          posting.applyUrl ??
          `https://careers.smartrecruiters.com/${encodeURIComponent(this.companyIdentifier)}`,
        publishedAt: new Date(posting.releasedDate).toISOString(),
        candidateLocation: location || "Unknown",
        jobType: posting.typeOfEmployment?.label ?? null,
        salary: null,
        description: stripMarkup(description),
        tags: [
          posting.department?.label,
          posting.function?.label,
          posting.experienceLevel?.label,
        ].filter(
          (value): value is string => value !== undefined && value !== "",
        ),
      };
    });
  }
}
