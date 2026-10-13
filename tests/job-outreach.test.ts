import { describe, expect, it } from "vitest";

import type { GoogleSheetsWorkbookTransport } from "../src/integrations/google-sheets.js";
import { JobOutreachSheetRepository } from "../src/jobs/outreach-sheet.js";
import {
  buildOutreachDrafts,
  buildOutreachPlan,
  createdOutreachDraftsSchema,
  formatOutreachPlan,
  outreachRows,
  parseOutreachCsv,
  planOutreachImport,
  resolveOutreachRole,
} from "../src/jobs/outreach.js";
import { pipelineEntries } from "../src/jobs/review.js";

const now = new Date("2026-10-13T00:00:00Z");

const pipelineRow = (
  id: string,
  company: string,
  options: { fit?: number; verdict?: string; stage?: string; flags?: string },
): unknown[] => {
  const row: unknown[] = Array.from({ length: 27 }, () => "");
  row[0] = id;
  row[1] = `Role ${id}`;
  row[2] = company;
  row[19] = options.stage ?? "Discovered";
  row[22] = options.flags ?? "";
  row[23] = options.fit ?? "";
  row[24] = options.verdict ?? "";
  return row;
};

const entries = pipelineEntries(
  [
    pipelineRow("a", "Acme Inc", { fit: 70, verdict: "apply" }),
    pipelineRow("b", "Acme", { fit: 90, verdict: "apply_now" }),
    pipelineRow("c", "Skipped Co", { fit: 30, verdict: "skip" }),
    pipelineRow("d", "Unreviewed Co", {}),
    pipelineRow("e", "Closed Co", {
      fit: 80,
      verdict: "apply",
      flags: "Closed - no longer on the employer's board",
    }),
    pipelineRow("f", "Beta", { fit: 60, verdict: "stretch" }),
  ],
  now,
);

const sheetRow = (
  name: string,
  company: string,
  email: string,
  options: {
    sourceUrl?: string;
    opportunityId?: string;
    status?: string;
    contactedOn?: unknown;
    draftCreated?: string;
  } = {},
): unknown[] => [
  name,
  "Recruiter",
  company,
  email,
  options.sourceUrl ?? "https://example.com/careers",
  options.opportunityId ?? "",
  "",
  options.status ?? "Queued",
  options.contactedOn ?? "",
  "",
  "2026-10-10",
  options.draftCreated ?? "",
];

describe("outreach contacts CSV", () => {
  it("reads columns in any order and rejects unsourced or invalid rows", () => {
    const { contacts, rejected } = parseOutreachCsv(
      [
        "Email,Name,Company,Email Source URL,Title",
        "Asha@Example.com,Asha Rao,Acme,https://acme.example/careers,Talent Partner",
        "no-source@example.com,No Source,Acme,,",
        "not-an-email,Bad Email,Acme,https://acme.example/careers,",
        "ftp@example.com,Wrong Scheme,Acme,ftp://acme.example/careers,",
        ",,,,",
      ].join("\n"),
    );
    expect(contacts).toEqual([
      {
        name: "Asha Rao",
        title: "Talent Partner",
        company: "Acme",
        email: "asha@example.com",
        sourceUrl: "https://acme.example/careers",
        opportunityId: "",
        notes: "",
      },
    ]);
    expect(rejected.map((entry) => entry.line)).toEqual([3, 4, 5]);
    expect(rejected[0]?.reason).toContain("sourceUrl");
  });

  it("refuses a file without the required columns", () => {
    expect(() => parseOutreachCsv("name,email,company\nA,a@b.co,Acme")).toThrow(
      "missing required columns: sourceUrl",
    );
  });
});

describe("outreach role linking", () => {
  it("links the best-fit role that passed review at the same company", () => {
    const link = (company: string, opportunityId = ""): string | undefined =>
      resolveOutreachRole({ company, opportunityId }, entries)?.id;
    expect(link("ACME, Inc.")).toBe("b");
    expect(link("Acme", "a")).toBe("a");
    expect(link("Acme", "c")).toBe("b");
    expect(link("Skipped Co")).toBeUndefined();
    expect(link("Unreviewed Co")).toBeUndefined();
    expect(link("Closed Co")).toBeUndefined();
  });
});

describe("outreach import", () => {
  it("skips duplicates and do-not-contact addresses", () => {
    const { contacts } = parseOutreachCsv(
      [
        "name,company,email,source_url",
        "New One,Acme,new@example.com,https://acme.example/a",
        "New Again,Acme,NEW@example.com,https://acme.example/a",
        "Known,Acme,known@example.com,https://acme.example/a",
        "Blocked,Acme,blocked@example.com,https://acme.example/a",
        "Nowhere,Unreviewed Co,nowhere@example.com,https://u.example/a",
      ].join("\n"),
    );
    const result = planOutreachImport(
      contacts,
      outreachRows([
        sheetRow("Known", "Acme", "known@example.com"),
        sheetRow("Blocked", "Acme", "blocked@example.com", {
          status: "Do not contact",
        }),
      ]),
      entries,
      "2026-10-13",
    );
    expect(result.duplicates).toEqual(["new@example.com", "known@example.com"]);
    expect(result.doNotContact).toEqual(["blocked@example.com"]);
    expect(result.unlinked).toEqual(["nowhere@example.com"]);
    expect(result.rows).toEqual([
      [
        "New One",
        "",
        "Acme",
        "new@example.com",
        "https://acme.example/a",
        "b",
        "Role b",
        "Queued",
        "",
        "",
        "2026-10-13",
      ],
      [
        "Nowhere",
        "",
        "Unreviewed Co",
        "nowhere@example.com",
        "https://u.example/a",
        "",
        "",
        "Queued",
        "",
        "",
        "2026-10-13",
      ],
    ]);
  });
});

describe("outreach plan", () => {
  it("batches only contacts tied to a role that passed review", () => {
    const plan = buildOutreachPlan(
      [
        sheetRow("Beta One", "Beta", "one@beta.example"),
        sheetRow("Acme One", "Acme", "one@acme.example"),
        sheetRow("Skipped", "Skipped Co", "x@skipped.example"),
        sheetRow("Unsourced", "Acme", "two@acme.example", { sourceUrl: "" }),
        sheetRow("Bad", "Acme", "not-an-email"),
        sheetRow("Sent", "Acme", "sent@acme.example", {
          status: "Sent",
          contactedOn: "2026-10-12",
        }),
        sheetRow("Sent Again", "Acme", "sent@acme.example"),
        sheetRow("Blocked", "Acme", "no@acme.example", {
          status: "Do not contact",
        }),
        sheetRow("Typed", "Acme", "typed@acme.example", { status: "" }),
        sheetRow("Typed Twice", "Acme", "typed@acme.example", { status: "" }),
      ],
      entries,
      { today: "2026-10-13" },
    );
    expect(plan.batch.map(({ row, role }) => [row.name, role.id])).toEqual([
      ["Acme One", "b"],
      ["Typed", "b"],
      ["Beta One", "f"],
    ]);
    expect(plan.held.map(({ row, reason }) => [row.name, reason])).toEqual([
      ["Skipped", "No role at this company has passed review"],
      ["Unsourced", "No public source URL for the email"],
      ["Bad", "Email is missing or invalid"],
      ["Sent Again", "Already handled on row 7"],
      ["Typed Twice", "Already handled on row 10"],
    ]);
    const output = formatOutreachPlan(plan);
    expect(output).toContain("0 sent today, daily cap 20, 3 in today's batch");
    expect(output).toContain(
      "- Row 3 | Acme One (Recruiter) | one@acme.example | Acme - Role b | fit 90 (apply_now)",
    );
  });

  it("never plans past the daily cap less what was sent today", () => {
    // 46308 is the Sheets serial number for 2026-10-13.
    const sent = [46308, "2026-10-13", "2026-10-12"].map((contactedOn, index) =>
      sheetRow("Sent", "Acme", `sent${String(index)}@acme.example`, {
        status: "Sent",
        contactedOn,
      }),
    );
    const queued = Array.from({ length: 5 }, (_, index) =>
      sheetRow("Queued", "Acme", `queued${String(index)}@acme.example`),
    );
    const plan = buildOutreachPlan([...sent, ...queued], entries, {
      today: "2026-10-13",
      cap: 4,
    });
    expect(plan.sentToday).toBe(2);
    expect(plan.batch.map(({ row }) => row.rowNumber)).toEqual([5, 6]);
    expect(plan.deferred).toBe(3);
    expect(
      buildOutreachPlan([...sent, ...queued], entries, {
        today: "2026-10-13",
        cap: 1,
      }).batch,
    ).toEqual([]);
  });
});

describe("outreach drafts", () => {
  it("fills the role's outreach draft with the contact's name", () => {
    const kitRow = (id: string, draft: string): unknown[] => {
      const row: unknown[] = Array.from({ length: 8 }, () => "");
      row[0] = id;
      row[7] = draft;
      return row;
    };
    const plan = buildOutreachPlan(
      [
        sheetRow("Asha Rao", "Acme", "Asha@Acme.example"),
        sheetRow("Drafted", "Acme", "drafted@acme.example", {
          draftCreated: "2026-10-12",
        }),
        sheetRow("Beta One", "Beta", "one@beta.example"),
      ],
      entries,
      { today: "2026-10-13" },
    );
    const result = buildOutreachDrafts(plan, [
      kitRow(
        "b",
        "Hello [name],\nI built a routing engine. [Name], shall we talk?",
      ),
      kitRow("f", ""),
    ]);
    expect(result.drafts).toEqual([
      {
        rowNumber: 2,
        to: "asha@acme.example",
        name: "Asha Rao",
        company: "Acme",
        opportunityId: "b",
        role: "Role b",
        subject: "Role b role at Acme",
        body: "Hello Asha Rao,\nI built a routing engine. Asha Rao, shall we talk?",
      },
    ]);
    expect(result.alreadyDrafted).toBe(1);
    expect(result.missing.map(({ row }) => row.name)).toEqual(["Beta One"]);
    expect(formatOutreachPlan(plan)).toContain(
      "drafted@acme.example | Acme - Role b | fit 90 (apply_now) | draft ready",
    );
  });

  it("accepts only row and address in the created-drafts file", () => {
    expect(
      createdOutreachDraftsSchema.parse([{ rowNumber: 2, to: "A@b.co" }]),
    ).toEqual([{ rowNumber: 2, to: "a@b.co" }]);
    expect(createdOutreachDraftsSchema.safeParse([]).success).toBe(false);
    expect(
      createdOutreachDraftsSchema.safeParse([
        { rowNumber: 2, to: "a@b.co", sent: true },
      ]).success,
    ).toBe(false);
  });
});

describe("outreach sheet", () => {
  it("stamps Draft Created only where the address still matches", async () => {
    const writes: { range: string; values: readonly (readonly unknown[])[] }[] =
      [];
    const transport: GoogleSheetsWorkbookTransport = {
      getValues: () =>
        Promise.resolve([
          sheetRow("Asha", "Acme", "asha@acme.example"),
          sheetRow("Moved", "Acme", "moved@acme.example"),
        ]),
      batchUpdateValues: (updates) => {
        writes.push(...updates);
        return Promise.resolve();
      },
      appendValues: () => Promise.resolve(),
      getSpreadsheet: <T>() => Promise.resolve({} as T),
      batchUpdateSpreadsheet: <T>() => Promise.resolve({} as T),
    };
    const result = await new JobOutreachSheetRepository(transport).recordDrafts(
      [
        { rowNumber: 2, to: "asha@acme.example" },
        { rowNumber: 3, to: "someone-else@acme.example" },
        { rowNumber: 9, to: "nobody@acme.example" },
      ],
      "2026-10-13",
    );
    expect(result).toEqual({ recorded: 1, mismatched: [3, 9] });
    expect(writes).toEqual([
      { range: "'Outreach'!L2", values: [["2026-10-13"]] },
    ]);
  });

  it("creates the tab with a status list and appends contacts", async () => {
    const requests: unknown[] = [];
    const writes: string[] = [];
    const transport: GoogleSheetsWorkbookTransport = {
      getValues: () => Promise.resolve([]),
      batchUpdateValues: (updates) => {
        writes.push(...updates.map((update) => update.range));
        return Promise.resolve();
      },
      appendValues: (range, values) => {
        writes.push(`${range} +${String(values.length)}`);
        return Promise.resolve();
      },
      getSpreadsheet: <T>() =>
        Promise.resolve({
          sheets: [{ properties: { title: "Job Pipeline" } }],
        } as T),
      batchUpdateSpreadsheet: <T>(batch: readonly unknown[]) => {
        requests.push(...batch);
        return Promise.resolve({
          replies: [{ addSheet: { properties: { sheetId: 7 } } }],
        } as T);
      },
    };
    const repository = new JobOutreachSheetRepository(transport);
    await repository.ensureSheet();
    await repository.appendContacts([]);
    await repository.appendContacts([["Asha"]]);
    expect(JSON.stringify(requests[0])).toContain('"title":"Outreach"');
    expect(JSON.stringify(requests[1])).toContain(
      '"sheetId":7,"startRowIndex":1,"endRowIndex":1000,"startColumnIndex":7',
    );
    expect(writes).toEqual(["'Outreach'!A1:L1", "'Outreach'!A:L +1"]);
  });
});
