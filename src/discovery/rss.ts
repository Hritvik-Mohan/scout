import { XMLParser } from "fast-xml-parser";
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

const rssItemSchema = z
  .object({
    title: z.string().trim().min(1),
    link: z.string().url(),
    pubDate: z.string().trim().min(1),
    guid: z.union([z.string(), z.number()]).optional(),
    description: z.string().trim().min(1).optional(),
  })
  .passthrough();

const rssFeedSchema = z
  .object({
    rss: z
      .object({
        channel: z
          .object({
            item: z.array(z.unknown()).default([]),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

const parser = new XMLParser({
  ignoreAttributes: true,
  isArray: (tagName) => tagName === "item",
  maxNestedTags: 100,
  parseTagValue: false,
  processEntities: {
    enabled: true,
    maxEntityCount: 100,
    maxEntitySize: 1_000,
    maxExpandedLength: 100_000,
    maxExpansionDepth: 5,
    maxTotalExpansions: 1_000,
  },
  removeNSPrefix: true,
  trimValues: true,
});

const stripMarkup = (value: string | undefined): string | null => {
  if (value === undefined) {
    return null;
  }
  const text = value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text === "" ? null : text;
};

const publisherDomain = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

export interface RssDiscoveryAdapterOptions {
  fetch?: FetchLike;
  now?: () => Date;
}

export class RssDiscoveryAdapter implements DiscoveryAdapter {
  readonly provider = "rss";
  readonly sourceType = "rss" as const;

  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;

  constructor(options: RssDiscoveryAdapterOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async discover(
    request: DiscoveryRequest,
  ): Promise<readonly DiscoveryDocument[]> {
    assertDiscoveryRequest(request, this.sourceType);

    let feedUrl: URL;
    try {
      feedUrl = new URL(request.source.queryOrUrl);
    } catch (error) {
      throw new DiscoveryHttpError("RSS source URL is invalid", {
        cause: error,
      });
    }
    if (feedUrl.protocol !== "https:" && feedUrl.protocol !== "http:") {
      throw new DiscoveryHttpError("RSS source must use HTTP or HTTPS");
    }

    const body = await fetchDiscoveryText(
      this.fetchImpl,
      feedUrl,
      "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
    );

    let parsedXml: unknown;
    try {
      parsedXml = parser.parse(body);
    } catch (error) {
      throw new DiscoveryHttpError("RSS source returned invalid XML", {
        cause: error,
      });
    }

    const parsedFeed = rssFeedSchema.safeParse(parsedXml);
    if (!parsedFeed.success) {
      throw new DiscoveryHttpError("RSS source returned an unexpected feed");
    }

    const retrievedAt = this.now().toISOString();
    const documents: DiscoveryDocument[] = [];
    for (const unparsedItem of parsedFeed.data.rss.channel.item) {
      const parsedItem = rssItemSchema.safeParse(unparsedItem);
      if (!parsedItem.success) {
        continue;
      }
      const item = parsedItem.data;
      const publishedAt = new Date(item.pubDate);
      if (
        Number.isNaN(publishedAt.valueOf()) ||
        !isInsideDiscoveryWindow(publishedAt, request)
      ) {
        continue;
      }

      documents.push(
        discoveryDocumentSchema.parse({
          documentId: item.guid === undefined ? item.link : String(item.guid),
          sourceId: request.source.sourceId,
          sourceName: request.source.sourceName,
          sourceType: this.sourceType,
          provider: this.provider,
          queryOrUrl: request.source.queryOrUrl,
          segment: request.source.segment,
          title: item.title,
          url: item.link,
          publishedAt: publishedAt.toISOString(),
          retrievedAt,
          summary: stripMarkup(item.description),
          publisherDomain: publisherDomain(item.link),
          language: null,
          sourceCountry: null,
        }),
      );

      if (documents.length === request.maxResults) {
        break;
      }
    }

    return documents;
  }
}
