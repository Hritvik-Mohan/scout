import { describe, expect, it, vi } from "vitest";

import type { FetchLike } from "../src/discovery/http.js";
import { AshbyJobDiscoveryAdapter } from "../src/jobs/ashby.js";
import { assessJob } from "../src/jobs/assess.js";
import { jobFlags } from "../src/jobs/flags.js";
import { GreenhouseJobDiscoveryAdapter } from "../src/jobs/greenhouse.js";
import {
  DEFAULT_JOB_SEARCH,
  jobSearchConfigSchema,
  loadJobSearchConfig,
  type JobSearchConfig,
} from "../src/jobs/search-config.js";
import { LeverJobDiscoveryAdapter } from "../src/jobs/lever.js";
import type { DiscoveredJob } from "../src/jobs/model.js";
import { JobPipelineSheetRepository } from "../src/jobs/pipeline-sheet.js";
import { RemotiveJobDiscoveryAdapter } from "../src/jobs/remotive.js";
import { SmartRecruitersJobDiscoveryAdapter } from "../src/jobs/smartrecruiters.js";
import {
  createJobDiscoveryAdapter,
  parseConfiguredJobSources,
} from "../src/jobs/sources.js";
import type { GoogleSheetsTransport } from "../src/integrations/google-sheets.js";
import { requireSearchFile, searchPaths } from "../src/jobs/search-paths.js";
import { loadScoutProfile } from "../src/profiles/loader.js";
import { scoreOpportunity } from "../src/profiles/scorer.js";
import { scoutProfileSchema } from "../src/profiles/schema.js";

const job = (): DiscoveredJob => ({
  id: "remotive:42",
  provider: "Remotive",
  title: "Software Engineer II, Backend Platform",
  company: "Example Labs",
  url: "https://remotive.com/remote-jobs/software-dev/example-42",
  publishedAt: "2026-10-07T10:00:00.000Z",
  candidateLocation: "Worldwide",
  jobType: "full_time",
  salary: "$60,000-$80,000",
  description:
    "Own and design distributed Node.js and TypeScript microservices on AWS. Build APIs, queues, observability, automated tests, CI/CD, and mentor teammates. Minimum 3 years experience.",
  tags: ["Node.js", "TypeScript", "AWS"],
});

const profile = scoutProfileSchema.parse({
  schemaVersion: 1,
  id: "jobs_test",
  name: "Test jobs",
  description: "Test profile",
  purpose: "jobs",
  targetEntity: "Software engineering role",
  geographyPriority: ["Remote (India-compatible)"],
  criteria: [
    {
      id: "role_family_fit",
      label: "Role",
      description: "Role",
      weight: 1,
      required: true,
      evidenceRequired: true,
    },
    {
      id: "technical_domain_fit",
      label: "Tech",
      description: "Tech",
      weight: 1,
      required: true,
      evidenceRequired: true,
    },
    {
      id: "seniority_fit",
      label: "Level",
      description: "Level",
      weight: 1,
      required: true,
      evidenceRequired: true,
    },
    {
      id: "location_and_authorization_fit",
      label: "Location",
      description: "Location",
      weight: 1,
      required: true,
      evidenceRequired: true,
    },
  ],
  signals: [],
  disqualifiers: [
    {
      id: "work_authorization_mismatch",
      label: "Location mismatch",
      description: "Mismatch",
      hard: true,
    },
    {
      id: "clearly_too_senior",
      label: "Too senior",
      description: "Too senior",
      hard: true,
    },
    {
      id: "non_development_role",
      label: "Not development",
      description: "Not development",
      hard: true,
    },
    {
      id: "specialization_mismatch",
      label: "Specialist mismatch",
      description: "Mismatch",
      hard: true,
    },
  ],
  thresholds: { keep: 2.5, action: 4 },
  outputFields: ["role"],
});

describe("Remotive job discovery", () => {
  it("normalizes current software-development jobs and filters the date window", async () => {
    const fetchMock = vi.fn<FetchLike>().mockResolvedValue(
      new Response(
        JSON.stringify({
          jobs: [
            {
              id: 42,
              url: job().url,
              title: job().title,
              company_name: job().company,
              publication_date: "2026-10-07T10:00:00",
              candidate_required_location: "Worldwide",
              job_type: "full_time",
              salary: "$60,000-$80,000",
              description: "<p>Build Node.js APIs.</p>",
              tags: ["Node.js"],
            },
          ],
        }),
      ),
    );
    const jobs = await new RemotiveJobDiscoveryAdapter(fetchMock).discover({
      startAt: new Date("2026-10-01T00:00:00.000Z"),
      endAt: new Date("2026-10-08T00:00:00.000Z"),
      maxResults: 10,
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: "remotive:42",
      provider: "Remotive",
      description: "Build Node.js APIs.",
    });
    const requestUrl = fetchMock.mock.calls[0]?.[0] as URL;
    expect(requestUrl.searchParams.get("category")).toBe("software-dev");
  });
});

describe("company ATS job discovery", () => {
  const request = {
    startAt: new Date("2026-10-01T00:00:00.000Z"),
    endAt: new Date("2026-10-08T00:00:00.000Z"),
    maxResults: 10,
  };

  it("normalizes an active Greenhouse posting", async () => {
    const posting = {
      id: 81,
      title: "Backend Software Engineer II",
      absolute_url: "https://boards.greenhouse.io/example/jobs/81",
      updated_at: "2026-09-01T12:00:00Z",
      location: { name: "India; Remote" },
      departments: [{ name: "Engineering" }],
      offices: [{ name: "Remote - India" }],
    };
    const fetchMock = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobs: [posting] })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...posting,
            content: "<p>Build distributed TypeScript APIs.</p>",
          }),
        ),
      );
    const jobs = await new GreenhouseJobDiscoveryAdapter({
      boardToken: "example",
      company: "Example",
      fetch: fetchMock,
    }).discover(request);
    expect(jobs[0]).toMatchObject({
      id: "greenhouse:example:81",
      provider: "Greenhouse: Example",
      candidateLocation: "India; Remote",
      description: "Build distributed TypeScript APIs.",
    });
    const requestUrl = fetchMock.mock.calls[0]?.[0] as URL;
    expect(requestUrl.searchParams.get("content")).toBeNull();
    expect((fetchMock.mock.calls[1]?.[0] as URL).pathname).toContain(
      "/jobs/81",
    );
  });

  it("keeps Greenhouse postings located only in Bengaluru", async () => {
    const posting = {
      id: 82,
      title: "Software Engineer",
      absolute_url: "https://boards.greenhouse.io/example/jobs/82",
      updated_at: "2026-09-01T12:00:00Z",
      location: { name: "Bangalore" },
    };
    const fetchMock = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobs: [posting] })))
      .mockResolvedValueOnce(new Response(JSON.stringify(posting)));
    const jobs = await new GreenhouseJobDiscoveryAdapter({
      boardToken: "example",
      company: "Example",
      fetch: fetchMock,
    }).discover(request);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.candidateLocation).toBe("Bangalore");
  });

  it("normalizes an active Lever posting", async () => {
    const fetchMock = vi.fn<FetchLike>().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: "abc",
            text: "Software Development Engineer II",
            hostedUrl: "https://jobs.lever.co/example/abc",
            createdAt: Date.parse("2026-09-01T12:00:00Z"),
            categories: {
              commitment: "Full-time",
              department: "Engineering",
              location: "India (Remote)",
              allLocations: ["India (Remote)", "Bangalore, India"],
            },
            descriptionPlain: "Build reliable backend services.",
            lists: [{ text: "Requirements", content: "<li>Node.js APIs</li>" }],
            workplaceType: "remote",
          },
        ]),
      ),
    );
    const jobs = await new LeverJobDiscoveryAdapter({
      site: "example",
      company: "Example",
      fetch: fetchMock,
    }).discover(request);
    expect(jobs[0]).toMatchObject({
      id: "lever:example:abc",
      provider: "Lever: Example",
      candidateLocation: "India (Remote), Bangalore, India",
      jobType: "Full-time",
    });
    expect(jobs[0]?.description).toContain("Node.js APIs");
  });

  it("normalizes an active SmartRecruiters posting", async () => {
    const listed = {
      id: "123",
      uuid: "abc",
      name: "Backend Software Engineer",
      releasedDate: "2026-10-07T12:00:00Z",
      location: { city: "Bengaluru", country: "in", remote: false },
      company: { identifier: "Example", name: "Example India" },
      typeOfEmployment: { label: "Full-time" },
    };
    const fetchMock = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ content: [listed], totalFound: 1 })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...listed,
            postingUrl: "https://jobs.smartrecruiters.com/Example/123",
            department: { label: "Engineering" },
            function: { label: "Software Development" },
            jobAd: {
              sections: {
                jobDescription: { text: "Build distributed Java services." },
                qualifications: { text: "2+ years experience." },
              },
            },
          }),
        ),
      );
    const jobs = await new SmartRecruitersJobDiscoveryAdapter({
      companyIdentifier: "Example",
      company: "Example",
      fetch: fetchMock,
    }).discover(request);
    expect(jobs[0]).toMatchObject({
      id: "smartrecruiters:Example:123",
      provider: "SmartRecruiters: Example",
      company: "Example India",
      candidateLocation: "Bengaluru, in",
      jobType: "Full-time",
    });
    expect(jobs[0]?.description).toContain("distributed Java services");
  });

  it("normalizes an active Ashby posting", async () => {
    const fetchMock = vi.fn<FetchLike>().mockResolvedValue(
      new Response(
        JSON.stringify({
          jobs: [
            {
              id: "ashby-123",
              title: "Software Engineer II, Platform",
              jobUrl: "https://jobs.ashbyhq.com/example/ashby-123",
              publishedAt: "2026-10-07T12:00:00Z",
              location: "Bengaluru, India",
              descriptionPlain: "Build distributed TypeScript services.",
              department: "Engineering",
              team: "Platform",
              employmentType: "Full-time",
              workplaceType: "Hybrid",
            },
          ],
        }),
      ),
    );
    const jobs = await new AshbyJobDiscoveryAdapter({
      boardName: "example",
      company: "Example",
      fetch: fetchMock,
    }).discover(request);
    expect(jobs[0]).toMatchObject({
      id: "ashby:example:ashby-123",
      provider: "Ashby: Example",
      candidateLocation: "Bengaluru, India",
      jobType: "Full-time",
      description: "Build distributed TypeScript services.",
    });
  });

  it("accepts Ashby postings with null optional fields", async () => {
    const fetchMock = vi.fn<FetchLike>().mockResolvedValue(
      new Response(
        JSON.stringify({
          jobs: [
            {
              id: "ashby-456",
              title: "Platform Engineer",
              jobUrl: "https://jobs.ashbyhq.com/example/ashby-456",
              publishedAt: "2026-10-07T12:00:00Z",
              location: "Bengaluru, India",
              descriptionPlain: "Build platform services.",
              department: null,
              team: null,
              employmentType: null,
              workplaceType: null,
              isRemote: null,
            },
          ],
        }),
      ),
    );
    const jobs = await new AshbyJobDiscoveryAdapter({
      boardName: "example",
      company: "Example",
      fetch: fetchMock,
    }).discover(request);
    expect(jobs[0]).toMatchObject({
      id: "ashby:example:ashby-456",
      jobType: null,
      tags: [],
    });
  });

  it("builds adapters only from active recognized source rows", () => {
    const sources = parseConfiguredJobSources([
      [
        "lever-example",
        "Example",
        "lever",
        "https://api.lever.co/v0/postings/example?mode=json",
        "India",
        true,
      ],
      ["ignored", "Query", "job_search", "software engineer", "India", true],
    ]);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.rowNumber).toBe(2);
    const source = sources[0];
    if (source === undefined) throw new Error("Expected source");
    expect(createJobDiscoveryAdapter(source)).toBeInstanceOf(
      LeverJobDiscoveryAdapter,
    );
  });

  it("creates a SmartRecruiters adapter from a public company endpoint", () => {
    const source = parseConfiguredJobSources([
      [
        "smart-example",
        "Example",
        "smartrecruiters",
        "https://api.smartrecruiters.com/v1/companies/Example/postings",
        "India",
        true,
      ],
    ])[0];
    if (source === undefined) throw new Error("Expected source");
    expect(createJobDiscoveryAdapter(source)).toBeInstanceOf(
      SmartRecruitersJobDiscoveryAdapter,
    );
  });

  it("creates an Ashby adapter from a public board endpoint", () => {
    const source = parseConfiguredJobSources([
      [
        "ashby-example",
        "Example",
        "ashby",
        "https://api.ashbyhq.com/posting-api/job-board/example",
        "India",
        true,
      ],
    ])[0];
    if (source === undefined) throw new Error("Expected source");
    expect(createJobDiscoveryAdapter(source)).toBeInstanceOf(
      AshbyJobDiscoveryAdapter,
    );
  });
});

describe("deterministic job assessment", () => {
  it("recognizes a worldwide backend Engineer II role as actionable", () => {
    const assessed = assessJob(job());
    expect(scoreOpportunity(profile, assessed.assessment)).toMatchObject({
      status: "action",
      geographyRank: 0,
    });
    expect(assessed.experienceRequired).toBe("3+ years");
  });

  it("rejects a location-restricted staff role", () => {
    const assessed = assessJob({
      ...job(),
      title: "Staff Backend Engineer",
      candidateLocation: "USA only",
    });
    expect(assessed.assessment.disqualifiers).toEqual(
      expect.arrayContaining([
        "work_authorization_mismatch",
        "clearly_too_senior",
      ]),
    );
  });

  it("rejects explicit SDE III, SDE IV, and lead-engineer levels", () => {
    for (const title of [
      "SDE III",
      "SDE- IV / Lead Engineer",
      "Lead Engineer",
    ]) {
      const assessed = assessJob({
        ...job(),
        title,
        candidateLocation: "Bangalore, India",
      });
      expect(assessed.assessment.disqualifiers).toContain("clearly_too_senior");
    }
  });

  it("rejects code-training contracts and unproven APAC-only eligibility", () => {
    const trainer = assessJob({
      ...job(),
      title: "Software Engineer / AI Code Trainer",
      candidateLocation: "India",
    });
    expect(trainer.assessment.disqualifiers).toContain("non_development_role");

    const apac = assessJob({
      ...job(),
      title: "Senior React Full-stack Developer",
      candidateLocation: "Europe, USA, Canada, APAC",
      description: `${job().description} Minimum 5 years experience.`,
    });
    expect(apac.assessment.disqualifiers).toContain(
      "work_authorization_mismatch",
    );
    expect(apac.assessment.criteria.seniority_fit?.matched).toBe(false);
  });

  it("accepts Bengaluru roles and rejects non-remote roles elsewhere in India", () => {
    const bengaluru = assessJob({
      ...job(),
      provider: "Greenhouse: Example",
      candidateLocation: "Bengaluru, India",
      description: "Build backend TypeScript services in our office.",
    });
    expect(bengaluru.assessment.geography).toBe("Bengaluru");
    expect(bengaluru.assessment.disqualifiers).not.toContain(
      "work_authorization_mismatch",
    );

    const hyderabadOnSite = assessJob({
      ...job(),
      provider: "Greenhouse: Example",
      candidateLocation: "Hyderabad, India",
      description: "Build backend TypeScript services in our Hyderabad office.",
      tags: ["Engineering"],
    });
    expect(hyderabadOnSite.assessment.disqualifiers).toContain(
      "work_authorization_mismatch",
    );

    const remoteIndia = assessJob({
      ...job(),
      provider: "Lever: Example",
      candidateLocation: "India",
      description: "This is a fully remote backend TypeScript role.",
      tags: ["remote"],
    });
    expect(remoteIndia.assessment.geography).toBe("Remote (India-compatible)");
    expect(remoteIndia.assessment.disqualifiers).not.toContain(
      "work_authorization_mismatch",
    );
  });
});

describe("job search configuration", () => {
  const dataSearch: JobSearchConfig = {
    ...DEFAULT_JOB_SEARCH,
    roleTitles: ["data analyst"],
    technicalTerms: ["sql", "tableau", "python"],
    primaryLocations: ["pune"],
    primaryLocationLabel: "Pune",
    maxLevel: 3,
  };
  const analyst = {
    ...job(),
    title: "Data Analyst III",
    candidateLocation: "Pune, India",
    description: "Build SQL and Tableau dashboards. Minimum 3 years.",
    tags: [],
  };

  it("assesses a different role, stack and city from config alone", () => {
    const assessed = assessJob(analyst, dataSearch).assessment;
    expect(assessed.disqualifiers).toEqual([]);
    expect(assessed.geography).toBe("Pune");
    expect(assessed.criteria.role_family_fit?.matched).toBe(true);
    expect(assessed.criteria.technical_domain_fit?.matched).toBe(true);
  });

  it("rejects the same posting under the default search", () => {
    const assessed = assessJob(analyst).assessment;
    expect(assessed.criteria.role_family_fit?.matched).toBe(false);
  });

  it("ships a consistent fictional example for another search", async () => {
    const john = await loadJobSearchConfig("examples/john-doe/job-search.json");
    const johnProfile = await loadScoutProfile("examples/john-doe/jobs.json");
    expect(johnProfile.geographyPriority).toEqual(
      expect.arrayContaining([john.primaryLocationLabel, john.remoteLabel]),
    );
    const frontend = assessJob(
      {
        ...job(),
        provider: "Greenhouse: Example",
        title: "Frontend Engineer",
        candidateLocation: "London, United Kingdom",
        description:
          "Own and build React and TypeScript components in our design system. Accessibility, performance, Playwright tests and code review matter here. 3+ years.",
        tags: [],
      },
      john,
    );
    expect(frontend.assessment.disqualifiers).toEqual([]);
    expect(frontend.assessment.geography).toBe("London");
    expect(scoreOpportunity(johnProfile, frontend.assessment).status).not.toBe(
      "reject",
    );
    expect(
      assessJob({ ...job(), title: "Backend Engineer" }, john).assessment
        .disqualifiers,
    ).toContain("specialization_mismatch");
  });

  it("rejects unknown keys", () => {
    expect(
      jobSearchConfigSchema.safeParse({ ...dataSearch, city: "Pune" }).success,
    ).toBe(false);
  });

  it("defaults to the ignored my-search folder and honours overrides", async () => {
    expect(searchPaths({}).profile.endsWith("my-search/jobs.json")).toBe(true);
    expect(searchPaths({}).icp.endsWith("my-search/job-search-icp.md")).toBe(
      true,
    );
    expect(
      searchPaths({
        SCOUT_JOB_SEARCH_PATH: "examples/john-doe/job-search.json",
      }).search.endsWith("examples/john-doe/job-search.json"),
    ).toBe(true);
    await expect(requireSearchFile("my-search/missing.json")).rejects.toThrow(
      /cp -R examples\/john-doe my-search/u,
    );
  });
});

describe("job assessment level and role filters", () => {
  it.each([
    ["Software Development Engineer III | Backend", "clearly_too_senior"],
    ["Sr.Manager, Software Engineering", "clearly_too_senior"],
    ["Senior SDET - Backend Platform", "non_development_role"],
    ["Senior Software Engineer in Test", "non_development_role"],
  ])("rejects %s", (title, disqualifier) => {
    expect(assessJob({ ...job(), title }).assessment.disqualifiers).toContain(
      disqualifier,
    );
  });

  it("keeps a Software Engineer 2 title", () => {
    expect(
      assessJob({ ...job(), title: "Software Engineer 2, Backend" }).assessment
        .disqualifiers,
    ).toEqual([]);
  });
});

describe("job pipeline Sheet repository", () => {
  it("inserts a new role and verifies the automated fields", async () => {
    const writes: { range: string; values: readonly (readonly unknown[])[] }[] =
      [];
    const transport: GoogleSheetsTransport = {
      getValues: (range) => {
        if (range === "'Job Pipeline'!A2:W1000") return Promise.resolve([]);
        return Promise.resolve([
          [
            "remotive:42",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            5,
            "action",
          ],
        ]);
      },
      batchUpdateValues: (updates) => {
        writes.push(...updates);
        return Promise.resolve();
      },
      appendValues: () => Promise.resolve(),
    };
    const assessed = assessJob(job());
    const score = scoreOpportunity(profile, assessed.assessment);
    await expect(
      new JobPipelineSheetRepository(transport).upsert({
        job: job(),
        assessed,
        score,
      }),
    ).resolves.toBe("inserted");
    expect(writes.map((write) => write.range)).toEqual([
      "'Job Pipeline'!A2:Q2",
      "'Job Pipeline'!R2:V2",
      "'Job Pipeline'!AB2:AB2",
      "'Job Pipeline'!W2:W2",
    ]);
    expect(writes[2]?.values[0]?.[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });

  it("flags kept roles that differ from the SDE I/II target", () => {
    const flagsNow = new Date("2026-10-09T00:00:00Z");
    expect(
      jobFlags(
        { ...job(), title: "SDE II" },
        "",
        new Date("2026-12-09T00:00:00Z"),
      ),
    ).toEqual(["Posted over 45 days ago - confirm still open"]);
    expect(
      jobFlags(
        { ...job(), title: "Senior Software Engineer" },
        "5+ years stated",
        flagsNow,
      ),
    ).toEqual([
      "Senior title - above SDE I/II target",
      "Asks 5+ years - stretch",
    ]);
    expect(
      jobFlags(
        { ...job(), title: "Software Engineer - Winter Intern" },
        "",
        flagsNow,
      ),
    ).toEqual(["Internship"]);
    expect(
      jobFlags({ ...job(), title: "Data Engineer (SDE 2)" }, "", flagsNow),
    ).toEqual(["Data/ML-focused role"]);
    expect(
      jobFlags({ ...job(), title: "SDE II" }, "3+ years stated", flagsNow),
    ).toEqual([]);
  });

  it("flags a missing role first, then removes or closes it", async () => {
    const row = (id: string, applied: boolean, flags: string): unknown[] => {
      const cells: unknown[] = Array.from({ length: 23 }, () => "");
      cells[0] = id;
      cells[17] = applied;
      cells[19] = applied ? "Applied" : "Discovered";
      cells[22] = flags;
      return cells;
    };
    const missed =
      "Not found on the employer's board on 2026-10-11 - may be closed";
    const writes: { range: string; values: readonly (readonly unknown[])[] }[] =
      [];
    const transport: GoogleSheetsTransport = {
      getValues: () =>
        Promise.resolve([
          row("lever:acme:open", false, ""),
          row("lever:acme:first-miss", false, "Internship"),
          row("lever:acme:second-miss", false, missed),
          row("lever:acme:applied", true, `Internship; ${missed}`),
          row("ashby:other:1", false, ""),
        ]),
      batchUpdateValues: (updates) => {
        writes.push(...updates);
        return Promise.resolve();
      },
      appendValues: () => Promise.resolve(),
    };
    const outcome = await new JobPipelineSheetRepository(
      transport,
    ).reconcileMissing(
      ["lever:acme:"],
      new Set(["lever:acme:open"]),
      new Date("2026-10-12T04:00:00Z"),
    );
    expect(outcome).toEqual({
      flagged: 1,
      closed: 1,
      removed: ["lever:acme:second-miss"],
    });
    expect(writes).toEqual([
      {
        range: "'Job Pipeline'!W3:W3",
        values: [
          [
            "Internship; Not found on the employer's board on 2026-10-12 - may be closed",
          ],
        ],
      },
      {
        range: "'Job Pipeline'!A4:AB4",
        values: [Array.from({ length: 28 }, () => "")],
      },
      {
        range: "'Job Pipeline'!W5:W5",
        values: [
          [
            "Internship; Closed - no longer on the employer's board (confirmed 2026-10-12)",
          ],
        ],
      },
    ]);
  });
});
