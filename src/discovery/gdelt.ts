import { z } from "zod";

import {
  assertDiscoveryRequest,
  discoveryDocumentSchema,
  isInsideDiscoveryWindow,
  type DiscoveryAdapter,
  type DiscoveryDocument,
  type DiscoveryRequest,
} from "./contracts.js";
import {
  DiscoveryHttpError,
  fetchDiscoveryText,
  type FetchLike,
} from "./http.js";

const DEFAULT_GDELT_ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";

const gdeltArticleSchema = z
  .object({
    url: z.string().url(),
    title: z.string().trim().min(1),
    seendate: z.string().trim().min(1),
    domain: z.string().trim().min(1).optional(),
    language: z.string().trim().min(1).optional(),
    sourcecountry: z.string().trim().min(1).optional(),
  })
  .passthrough();

const gdeltResponseSchema = z
  .object({
    articles: z.array(gdeltArticleSchema),
  })
  .passthrough();

const toGdeltDateTime = (date: Date): string =>
  date.toISOString().replace(/\D/g, "").slice(0, 14);

const parseGdeltSeenDate = (value: string): Date | null => {
  const compact = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(value);
  let normalized = value;
  if (compact !== null) {
    const [, year, month, day, hour, minute, second] = compact;
    if (
      year === undefined ||
      month === undefined ||
      day === undefined ||
      hour === undefined ||
      minute === undefined ||
      second === undefined
    ) {
      return null;
    }
    normalized = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  }
  const date = new Date(normalized);
  return Number.isNaN(date.valueOf()) ? null : date;
};

export interface GdeltDiscoveryAdapterOptions {
  endpoint?: string;
  fetch?: FetchLike;
  now?: () => Date;
}

export class GdeltDiscoveryAdapter implements DiscoveryAdapter {
  readonly provider = "gdelt";
  readonly sourceType = "search_query" as const;

  private readonly endpoint: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;

  constructor(options: GdeltDiscoveryAdapterOptions = {}) {
    this.endpoint = options.endpoint ?? DEFAULT_GDELT_ENDPOINT;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async discover(
    request: DiscoveryRequest,
  ): Promise<readonly DiscoveryDocument[]> {
    assertDiscoveryRequest(request, this.sourceType);

    const url = new URL(this.endpoint);
    url.searchParams.set("query", request.source.queryOrUrl);
    url.searchParams.set("mode", "artlist");
    url.searchParams.set("format", "json");
    url.searchParams.set("sort", "datedesc");
    url.searchParams.set("maxrecords", String(request.maxResults));
    url.searchParams.set("startdatetime", toGdeltDateTime(request.startAt));
    url.searchParams.set("enddatetime", toGdeltDateTime(request.endAt));

    const body = await fetchDiscoveryText(
      this.fetchImpl,
      url,
      "application/json",
    );

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch (error) {
      throw new DiscoveryHttpError("GDELT returned invalid JSON", {
        cause: error,
      });
    }

    const parsed = gdeltResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new DiscoveryHttpError("GDELT returned an unexpected response");
    }

    const retrievedAt = this.now().toISOString();
    return parsed.data.articles
      .slice(0, request.maxResults)
      .flatMap((article) => {
        const publishedAt = parseGdeltSeenDate(article.seendate);
        if (
          publishedAt === null ||
          !isInsideDiscoveryWindow(publishedAt, request)
        ) {
          return [];
        }

        return [
          discoveryDocumentSchema.parse({
            documentId: article.url,
            sourceId: request.source.sourceId,
            sourceName: request.source.sourceName,
            sourceType: this.sourceType,
            provider: this.provider,
            queryOrUrl: request.source.queryOrUrl,
            segment: request.source.segment,
            title: article.title,
            url: article.url,
            publishedAt: publishedAt.toISOString(),
            retrievedAt,
            summary: null,
            publisherDomain: article.domain ?? null,
            language: article.language ?? null,
            sourceCountry: article.sourcecountry ?? null,
          }),
        ];
      });
  }
}
