import { describe, expect, it, vi } from "vitest";

import type { FetchLike } from "../src/discovery/http.js";
import { parseBangaloreStartupMap } from "../src/jobs/bangalore-startup-map.js";
import { enrichCompanyWebsite } from "../src/jobs/company-enrichment.js";

const flightHtml = (payload: unknown): string => {
  const flight = [1, `["$","component",null,${JSON.stringify(payload)}]`];
  return `<html><script>self.__next_f.push(${JSON.stringify(flight)})</script></html>`;
};

describe("Bangalore Startup Map discovery", () => {
  it("parses the public Next.js payload and summarizes engineering demand", () => {
    const companies = parseBangaloreStartupMap(
      flightHtml({
        cartoKey: "public",
        startups: [
          {
            name: "Example Labs",
            slug: "example-labs",
            kind: "startup",
            tagline: "Developer tools",
            description: "Builds reliable systems",
            stage: "Series A",
            sector: "SaaS",
            tags: ["developer tools"],
            area: "Indiranagar",
            hsr_location: "100 Feet Road",
            website: "https://example.com",
            founders: "A Founder",
            founder_links: [
              { name: "A Founder", url: "https://linkedin.com/in/a" },
            ],
          },
        ],
        roles: {
          "example-labs": [
            {
              track: "engineering",
              seniority: "junior",
              fresher_friendly: true,
              posted_day: 20734,
            },
          ],
        },
        roleKeywords: { "example-labs": ["backend", "software", "engineer"] },
        hiringAvailable: true,
      }),
    );
    expect(companies[0]).toMatchObject({
      id: "bangalore-startup-map:example-labs",
      name: "Example Labs",
      website: "https://example.com",
      openRolesHint: "backend, software, engineer",
    });
    expect(companies[0]?.hiringSignal).toContain("1 engineering");
  });
});

describe("public company contact enrichment", () => {
  it("collects only published links and emails without synthesizing contacts", async () => {
    const fetchMock = vi.fn<FetchLike>().mockImplementation((input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/careers")) {
        return Promise.resolve(
          new Response(
            '<a href="https://jobs.lever.co/example">Open roles</a><a href="mailto:careers@acme.dev">Email</a>',
          ),
        );
      }
      return Promise.resolve(
        new Response(
          '<a href="/careers">Careers</a><a href="/contact">Contact</a><a href="https://www.linkedin.com/company/example">LinkedIn</a><a href="https://github.com/example">GitHub</a>',
        ),
      );
    });
    const result = await enrichCompanyWebsite(
      "https://example.com",
      fetchMock,
      new Date("2026-10-08T00:00:00.000Z"),
    );
    expect(result).toMatchObject({
      careersPage: "https://example.com/careers",
      contactPage: "https://example.com/contact",
      linkedin: "https://www.linkedin.com/company/example",
      github: "https://github.com/example",
      recruitingEmail: "careers@acme.dev",
      lastEnriched: "2026-10-08T00:00:00.000Z",
    });
    expect(result.jobBoard).toContain("Lever");
  });
});
