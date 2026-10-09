import { describe, expect, it } from "vitest";

import {
  collectLetsCodeIntel,
  normalizeCompanyName,
  parseCsv,
  type LETS_CODE_SHEETS,
} from "./lets-code-workbook.js";

describe("parseCsv", () => {
  it("parses quoted commas and escaped quotes", () => {
    expect(
      parseCsv('"Company","Notes"\n"Acme","Remote, says ""hello"""\n'),
    ).toEqual([
      ["Company", "Notes"],
      ["Acme", 'Remote, says "hello"'],
    ]);
  });
});

describe("normalizeCompanyName", () => {
  it("matches India-labelled variants", () => {
    expect(normalizeCompanyName("Atlassian India")).toBe(
      normalizeCompanyName("Atlassian"),
    );
  });
});

describe("collectLetsCodeIntel", () => {
  it("deduplicates companies and resources while preserving source details", () => {
    const sheets: Record<(typeof LETS_CODE_SHEETS)[number], string[][]> = {
      "Freshers Hiring Companies": [
        ["Company Name"],
        [
          "Atlassian",
          "SaaS",
          "₹20 LPA",
          "https://a.test/jobs",
          "https://linkedin.test/a",
          "SDE",
          "OA",
          "Bangalore",
        ],
      ],
      "Remote-Friendly Companies": [
        ["Company Name"],
        [
          "Atlassian India",
          "Remote",
          "SaaS",
          "Backend",
          "https://a.test/jobs",
          "",
          "Bangalore",
        ],
      ],
      "Career Contacts": [["bad merged header"]],
      Jobs: [
        ["Company", "Role", "Batch", "Location", "Apply"],
        ["Acme", "SDE I", "2026", "Remote", "https://acme.test/job"],
      ],
      "Companies Hiring Freshers Above 20 LPA": [["Company"]],
      Resources: [
        ["Interview Preparation"],
        ["DSA"],
        ["https://resource.test"],
        ["Algorithms"],
        ["https://resource.test"],
      ],
    };
    const result = collectLetsCodeIntel(sheets);
    expect(result.companies).toHaveLength(1);
    expect(result.companies[0]?.roles).toContain("Backend");
    expect(result.jobs).toHaveLength(1);
    expect(result.resources).toEqual([
      {
        category: "Interview Preparation",
        title: "DSA; Algorithms",
        url: "https://resource.test",
      },
    ]);
  });
});
