import { describe, expect, it } from "vitest";

import {
  createJobSearchWorkbook,
  JOB_COMPANIES_SHEET,
  JOB_COMPANY_HEADERS,
  JOB_PIPELINE_HEADERS,
  JOB_PIPELINE_SHEET,
  JOB_PROFILE_SHEET,
  JOB_RUN_HEADERS,
  JOB_RUNS_SHEET,
  JOB_SOURCE_HEADERS,
  JOB_SOURCES_SHEET,
  type JobWorkbookApi,
} from "../src/jobs/google-workbook.js";
import { scoutProfileSchema } from "../src/profiles/schema.js";

const profile = scoutProfileSchema.parse({
  schemaVersion: 1,
  id: "jobs_test",
  name: "Test jobs",
  description: "Test job profile",
  purpose: "jobs",
  targetEntity: "A test software engineering role",
  geographyPriority: ["Remote"],
  criteria: [
    {
      id: "fit",
      label: "Fit",
      description: "Role fits",
      weight: 1,
      required: true,
      evidenceRequired: true,
    },
  ],
  signals: [],
  disqualifiers: [],
  thresholds: { keep: 2.5, action: 4 },
  outputFields: ["role"],
});

describe("job-search Google workbook", () => {
  it("creates, formats, shares, and verifies the workbook tabs", async () => {
    const values = new Map<string, readonly (readonly unknown[])[]>();
    let formattingCalls = 0;
    let sharedWith: readonly [string, string] | undefined;
    const api: JobWorkbookApi = {
      createSpreadsheet: () =>
        Promise.resolve({
          spreadsheetId: "sheet-123",
          spreadsheetUrl:
            "https://docs.google.com/spreadsheets/d/sheet-123/edit",
          sheets: [
            { properties: { title: JOB_PIPELINE_SHEET, sheetId: 1 } },
            { properties: { title: JOB_SOURCES_SHEET, sheetId: 2 } },
            { properties: { title: JOB_RUNS_SHEET, sheetId: 3 } },
            { properties: { title: JOB_PROFILE_SHEET, sheetId: 4 } },
            { properties: { title: JOB_COMPANIES_SHEET, sheetId: 5 } },
          ],
        }),
      batchUpdateValues: (_id, updates) => {
        for (const update of updates) values.set(update.range, update.values);
        return Promise.resolve();
      },
      batchUpdateSpreadsheet: () => {
        formattingCalls += 1;
        return Promise.resolve();
      },
      getValues: (_id, range) => {
        const exact = values.get(range);
        if (exact !== undefined) return Promise.resolve(exact);
        if (range.includes(JOB_PIPELINE_SHEET))
          return Promise.resolve([JOB_PIPELINE_HEADERS]);
        if (range.includes(JOB_SOURCES_SHEET))
          return Promise.resolve([JOB_SOURCE_HEADERS]);
        if (range.includes(JOB_RUNS_SHEET))
          return Promise.resolve([JOB_RUN_HEADERS]);
        if (range.includes(JOB_COMPANIES_SHEET))
          return Promise.resolve([JOB_COMPANY_HEADERS]);
        return Promise.resolve([["Field", "Value"]]);
      },
      shareSpreadsheet: (spreadsheetId, email) => {
        sharedWith = [spreadsheetId, email];
        return Promise.resolve();
      },
    };

    await expect(
      createJobSearchWorkbook(api, {
        title: "My job hunt",
        shareWith: "owner@example.com",
        profile,
      }),
    ).resolves.toMatchObject({
      spreadsheetId: "sheet-123",
      sharedWith: "owner@example.com",
      verified: true,
    });
    expect(sharedWith).toEqual(["sheet-123", "owner@example.com"]);
    expect(formattingCalls).toBe(1);
  });
});
