import { describe, expect, it, vi } from "vitest";

import {
  DiscoveryHttpError,
  DiscoveryRequestError,
  GdeltDiscoveryAdapter,
  RssDiscoveryAdapter,
  type DiscoveryRequest,
  type FetchLike,
} from "../src/index.js";

const searchRequest = (): DiscoveryRequest => ({
  source: {
    sourceId: "funding-search",
    sourceName: "Funding announcements",
    type: "search_query",
    queryOrUrl: '"funding round" OR "raises seed"',
    segment: "funded startups",
    active: true,
    lastSuccessfulFetch: null,
    cursorOrCheckpoint: null,
    error: null,
  },
  startAt: new Date("2026-10-05T00:00:00.000Z"),
  endAt: new Date("2026-10-07T00:00:00.000Z"),
  maxResults: 10,
});

const rssRequest = (): DiscoveryRequest => ({
  ...searchRequest(),
  source: {
    ...searchRequest().source,
    sourceId: "funding-rss",
    sourceName: "Funding feed",
    type: "rss",
    queryOrUrl: "https://news.example/feed.xml",
  },
});

const response = (
  body: string,
  init: { headers?: Record<string, string>; status?: number } = {},
): Response =>
  new Response(body, {
    ...(init.headers === undefined ? {} : { headers: init.headers }),
    status: init.status ?? 200,
  });

describe("GDELT discovery adapter", () => {
  it("builds a bounded UTC query and normalizes in-window articles", async () => {
    const fetchMock = vi.fn<FetchLike>().mockResolvedValue(
      response(
        JSON.stringify({
          articles: [
            {
              url: "https://publisher.example/acme-seed",
              title: "Acme raises a seed round",
              seendate: "20261006T113000Z",
              domain: "publisher.example",
              language: "English",
              sourcecountry: "India",
            },
            {
              url: "https://publisher.example/old",
              title: "Old announcement",
              seendate: "20261001T113000Z",
              domain: "publisher.example",
            },
          ],
        }),
      ),
    );
    const adapter = new GdeltDiscoveryAdapter({
      fetch: fetchMock,
      now: () => new Date("2026-10-07T00:01:00.000Z"),
    });

    const documents = await adapter.discover(searchRequest());

    expect(documents).toEqual([
      {
        documentId: "https://publisher.example/acme-seed",
        sourceId: "funding-search",
        sourceName: "Funding announcements",
        sourceType: "search_query",
        provider: "gdelt",
        queryOrUrl: '"funding round" OR "raises seed"',
        segment: "funded startups",
        title: "Acme raises a seed round",
        url: "https://publisher.example/acme-seed",
        publishedAt: "2026-10-06T11:30:00.000Z",
        retrievedAt: "2026-10-07T00:01:00.000Z",
        summary: null,
        publisherDomain: "publisher.example",
        language: "English",
        sourceCountry: "India",
      },
    ]);

    const calledUrl = fetchMock.mock.calls[0]?.[0];
    expect(calledUrl).toBeInstanceOf(URL);
    const url = calledUrl as URL;
    expect(url.searchParams.get("query")).toBe(
      '"funding round" OR "raises seed"',
    );
    expect(url.searchParams.get("startdatetime")).toBe("20261005000000");
    expect(url.searchParams.get("enddatetime")).toBe("20261007000000");
    expect(url.searchParams.get("maxrecords")).toBe("10");
    expect(url.searchParams.get("format")).toBe("json");
  });

  it("rejects invalid GDELT payloads", async () => {
    const adapter = new GdeltDiscoveryAdapter({
      fetch: vi.fn<FetchLike>().mockResolvedValue(response("not json")),
    });

    await expect(adapter.discover(searchRequest())).rejects.toThrow(
      /invalid JSON/,
    );
  });
});

describe("RSS discovery adapter", () => {
  it("parses configured RSS 2.0 feeds and skips stale or malformed items", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Funding feed</title>
          <link>https://news.example/</link>
          <description>Funding announcements</description>
          <item>
            <title>Beta raises Series A</title>
            <link>https://news.example/beta-series-a</link>
            <guid isPermaLink="false">story-123</guid>
            <pubDate>Tue, 06 Oct 2026 14:00:00 GMT</pubDate>
            <description><![CDATA[<p>Beta raised new capital.</p>]]></description>
          </item>
          <item>
            <title>Stale story</title>
            <link>https://news.example/stale</link>
            <pubDate>Thu, 01 Oct 2026 14:00:00 GMT</pubDate>
          </item>
          <item>
            <title>Missing date</title>
            <link>https://news.example/no-date</link>
          </item>
        </channel>
      </rss>`;
    const adapter = new RssDiscoveryAdapter({
      fetch: vi.fn<FetchLike>().mockResolvedValue(response(xml)),
      now: () => new Date("2026-10-07T00:01:00.000Z"),
    });

    const documents = await adapter.discover(rssRequest());

    expect(documents).toEqual([
      {
        documentId: "story-123",
        sourceId: "funding-rss",
        sourceName: "Funding feed",
        sourceType: "rss",
        provider: "rss",
        queryOrUrl: "https://news.example/feed.xml",
        segment: "funded startups",
        title: "Beta raises Series A",
        url: "https://news.example/beta-series-a",
        publishedAt: "2026-10-06T14:00:00.000Z",
        retrievedAt: "2026-10-07T00:01:00.000Z",
        summary: "Beta raised new capital.",
        publisherDomain: "news.example",
        language: null,
        sourceCountry: null,
      },
    ]);
  });

  it("rejects non-HTTP feed URLs", async () => {
    const request = rssRequest();
    request.source.queryOrUrl = "file:///private/feed.xml";
    const adapter = new RssDiscoveryAdapter({
      fetch: vi.fn<FetchLike>(),
    });

    await expect(adapter.discover(request)).rejects.toThrow(/HTTP or HTTPS/);
  });
});

describe("discovery safety boundaries", () => {
  it("rejects inactive, wrong-type, invalid-window, and oversized requests", async () => {
    const adapter = new GdeltDiscoveryAdapter({
      fetch: vi.fn<FetchLike>(),
    });

    const inactive = searchRequest();
    inactive.source.active = false;
    await expect(adapter.discover(inactive)).rejects.toBeInstanceOf(
      DiscoveryRequestError,
    );

    await expect(adapter.discover(rssRequest())).rejects.toThrow(/expected/);

    const invalidWindow = searchRequest();
    invalidWindow.endAt = invalidWindow.startAt;
    await expect(adapter.discover(invalidWindow)).rejects.toThrow(
      /must be earlier/,
    );

    const oversized = searchRequest();
    oversized.maxResults = 251;
    await expect(adapter.discover(oversized)).rejects.toThrow(/1 to 250/);
  });

  it("classifies throttling as retryable without exposing response bodies", async () => {
    const adapter = new GdeltDiscoveryAdapter({
      fetch: vi.fn<FetchLike>().mockResolvedValue(
        response("provider detail that should not enter the error", {
          status: 429,
        }),
      ),
    });

    let error: unknown;
    try {
      await adapter.discover(searchRequest());
    } catch (caught: unknown) {
      error = caught;
    }

    expect(error).toBeInstanceOf(DiscoveryHttpError);
    expect(error).toMatchObject({ retryable: true, status: 429 });
    expect((error as Error).message).not.toContain("provider detail");
  });

  it("rejects declared responses larger than two MiB", async () => {
    const adapter = new RssDiscoveryAdapter({
      fetch: vi.fn<FetchLike>().mockResolvedValue(
        response("small fixture", {
          headers: { "content-length": String(2 * 1024 * 1024 + 1) },
        }),
      ),
    });

    await expect(adapter.discover(rssRequest())).rejects.toThrow(/size limit/);
  });
});
