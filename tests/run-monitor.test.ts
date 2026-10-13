import { describe, expect, it, vi } from "vitest";

import { GitHubIssues } from "../src/integrations/github-issues.js";
import {
  evaluateRunHealth,
  issueKey,
  issueMarker,
  planIssues,
} from "../src/jobs/run-monitor.js";

const now = new Date("2026-10-13T14:00:00Z");
const run = (started: string, status = "success", error = ""): unknown[] => [
  "run-id",
  started,
  started,
  status,
  100,
  10,
  10,
  error,
];
const source = (
  id: string,
  lastChecked: string,
  options: { type?: string; active?: boolean } = {},
): unknown[] => [
  id,
  "Example",
  options.type ?? "lever",
  `https://api.lever.co/v0/postings/${id}?mode=json`,
  "Anywhere",
  options.active ?? true,
  lastChecked,
  "",
];

describe("run health", () => {
  it("is healthy when a run is recent and sources were checked", () => {
    expect(
      evaluateRunHealth(
        [run("2026-10-13T12:30:00Z")],
        [source("lever-acme", "2026-10-13T12:30:05Z")],
        { now },
      ),
    ).toEqual([]);
  });

  it("reports a refresh that has stopped, and nothing else", () => {
    const findings = evaluateRunHealth(
      [run("2026-10-11T03:30:00Z")],
      [source("lever-acme", "2026-10-11T03:30:05Z")],
      { now },
    );
    expect(findings.map((finding) => finding.key)).toEqual(["no-recent-run"]);
    expect(findings[0]?.body).toContain("2 days ago");
    expect(evaluateRunHealth([], [], { now })[0]?.body).toContain(
      "No run has ever been recorded",
    );
  });

  it("reports a failed run with its recorded error", () => {
    const findings = evaluateRunHealth(
      [run("2026-10-13T12:30:00Z", "failed", "lever-acme: request failed")],
      [],
      { now },
    );
    expect(findings[0]).toMatchObject({ key: "run-failed" });
    expect(findings[0]?.body).toContain("lever-acme: request failed");
  });

  it("reports only sources that stay unchecked past the stale window", () => {
    const findings = evaluateRunHealth(
      [
        run(
          "2026-10-13T12:30:00Z",
          "partial",
          "lever-gone: request returned HTTP 404 | lever-blip: timeout",
        ),
      ],
      [
        source("lever-gone", "2026-10-09T03:30:00Z"),
        source("lever-blip", "2026-10-13T03:30:00Z"),
        source("lever-never", ""),
        source("lever-off", "2026-01-01T00:00:00Z", { active: false }),
        source("linkedin", "", { type: "manual_alert" }),
      ],
      { now },
    );
    expect(findings.map((finding) => finding.key)).toEqual([
      "source-failing:lever-gone",
      "source-failing:lever-never",
    ]);
    expect(findings[0]?.body).toContain("4 days ago");
    expect(findings[0]?.body).toContain("HTTP 404");
    expect(findings[1]?.body).toContain("never been checked");
  });
});

describe("issue planning", () => {
  const finding = (key: string) => ({ key, title: key, body: "details" });

  it("round-trips the marker", () => {
    expect(issueKey(`text\n${issueMarker("source-failing:lever-acme")}`)).toBe(
      "source-failing:lever-acme",
    );
    expect(issueKey("an unrelated issue")).toBeNull();
  });

  it("creates missing issues, keeps open ones, and closes resolved ones", () => {
    const plan = planIssues(
      [finding("run-failed"), finding("source-failing:a")],
      [
        { number: 3, body: issueMarker("source-failing:a") },
        { number: 4, body: issueMarker("source-failing:b") },
        { number: 5, body: "a human's issue" },
      ],
    );
    expect(plan.create.map((item) => item.key)).toEqual(["run-failed"]);
    expect(plan.existing).toEqual(["source-failing:a"]);
    expect(plan.close).toEqual([4]);
  });
});

describe("GitHub issues client", () => {
  it("lists issues without pull requests and sends the token", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          { number: 1, body: "one", html_url: "u1" },
          { number: 2, body: null, html_url: "u2", pull_request: {} },
        ]),
      ),
    );
    const issues = new GitHubIssues({
      repository: "owner/name",
      token: "test-token",
      fetch: fetchMock,
    });
    await expect(issues.listOpen()).resolves.toEqual([
      { number: 1, body: "one" },
    ]);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://api.github.com/repos/owner/name/issues?state=open&per_page=100",
    );
    expect(
      (init?.headers as Record<string, string> | undefined)?.authorization,
    ).toBe("Bearer test-token");
  });

  it("rejects a malformed repository and surfaces HTTP errors", async () => {
    expect(
      () => new GitHubIssues({ repository: "not a repo", token: "t" }),
    ).toThrow(/owner\/name/u);
    const issues = new GitHubIssues({
      repository: "owner/name",
      token: "t",
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("{}", { status: 403 })),
    });
    await expect(issues.create("title", "body")).rejects.toThrow(/HTTP 403/u);
  });
});
