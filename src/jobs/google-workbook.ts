import type { AccessTokenProvider } from "../integrations/google-sheets.js";
import type { ScoutProfile } from "../profiles/schema.js";
import { JOB_SOURCE_CATALOG } from "./source-catalog.js";

export const JOB_PIPELINE_SHEET = "Job Pipeline";
export const JOB_SOURCES_SHEET = "Sources";
export const JOB_RUNS_SHEET = "Runs";
export const JOB_PROFILE_SHEET = "Profile";
export const JOB_COMPANIES_SHEET = "Companies";

export const JOB_PIPELINE_HEADERS = [
  "Opportunity ID",
  "Role",
  "Company",
  "Source URL",
  "Posted / Updated",
  "Location",
  "Work Mode",
  "Employment Model",
  "Timezone Overlap",
  "Experience Required",
  "Tech Stack",
  "Compensation",
  "Contact",
  "Referral Path",
  "Score",
  "Status",
  "Evidence",
  "Applied",
  "Application Date",
  "Stage",
  "Next Action",
  "Notes",
  "Flags",
] as const;

export const JOB_SOURCE_HEADERS = [
  "Source ID",
  "Source Name",
  "Type",
  "Query / URL",
  "Geography",
  "Active",
  "Last Checked",
  "Notes",
] as const;

export const JOB_RUN_HEADERS = [
  "Run ID",
  "Started",
  "Finished",
  "Status",
  "Opportunities Found",
  "Kept",
  "Action",
  "Error",
] as const;

export const JOB_COMPANY_HEADERS = [
  "Company ID",
  "Company",
  "Kind",
  "Stage",
  "Sector",
  "Area",
  "Local Address",
  "Website",
  "Careers Page",
  "Job Board / ATS",
  "Contact Page",
  "LinkedIn",
  "X / Twitter",
  "GitHub",
  "Other Socials",
  "Public Recruiting Email",
  "Other Public Emails",
  "Founders",
  "Founder Profiles",
  "Hiring Signal",
  "Open Roles Hint",
  "Source URL",
  "Last Enriched",
  "Evidence / Notes",
] as const;

export const JOB_SOURCE_ROWS = JOB_SOURCE_CATALOG;

interface CreatedSpreadsheet {
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  sheets?: { properties?: { sheetId?: number; title?: string } }[];
}

export interface JobWorkbookApi {
  createSpreadsheet(body: unknown): Promise<CreatedSpreadsheet>;
  batchUpdateValues(
    spreadsheetId: string,
    updates: readonly {
      range: string;
      values: readonly (readonly unknown[])[];
    }[],
  ): Promise<void>;
  batchUpdateSpreadsheet(
    spreadsheetId: string,
    requests: readonly unknown[],
  ): Promise<void>;
  getValues(
    spreadsheetId: string,
    range: string,
  ): Promise<readonly (readonly unknown[])[]>;
  shareSpreadsheet(spreadsheetId: string, email: string): Promise<void>;
}

export interface CreateJobWorkbookOptions {
  title: string;
  shareWith: string;
  profile: ScoutProfile;
}

export interface CreatedJobWorkbook {
  spreadsheetId: string;
  spreadsheetUrl: string;
  sharedWith: string;
  sheets: readonly string[];
  verified: boolean;
}

export class GoogleJobWorkbookApi implements JobWorkbookApi {
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    private readonly tokenProvider: AccessTokenProvider,
    options: { fetch?: typeof fetch; timeoutMs?: number } = {},
  ) {
    this.fetchImplementation = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  createSpreadsheet(body: unknown): Promise<CreatedSpreadsheet> {
    return this.request<CreatedSpreadsheet>(
      "https://sheets.googleapis.com/v4/spreadsheets",
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  async batchUpdateValues(
    spreadsheetId: string,
    updates: readonly {
      range: string;
      values: readonly (readonly unknown[])[];
    }[],
  ): Promise<void> {
    await this.request(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
      {
        method: "POST",
        body: JSON.stringify({
          valueInputOption: "RAW",
          data: updates.map((update) => ({
            range: update.range,
            majorDimension: "ROWS",
            values: update.values,
          })),
        }),
      },
    );
  }

  async batchUpdateSpreadsheet(
    spreadsheetId: string,
    requests: readonly unknown[],
  ): Promise<void> {
    await this.request(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      { method: "POST", body: JSON.stringify({ requests }) },
    );
  }

  async getValues(
    spreadsheetId: string,
    range: string,
  ): Promise<readonly (readonly unknown[])[]> {
    const result = await this.request<{ values?: unknown[][] }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`,
      { method: "GET" },
    );
    return result.values ?? [];
  }

  async shareSpreadsheet(spreadsheetId: string, email: string): Promise<void> {
    await this.request(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheetId)}/permissions?sendNotificationEmail=true`,
      {
        method: "POST",
        body: JSON.stringify({
          type: "user",
          role: "writer",
          emailAddress: email,
        }),
      },
    );
  }

  private async request<T = unknown>(
    url: string,
    init: RequestInit,
  ): Promise<T> {
    const token = await this.tokenProvider.getAccessToken();
    const response = await this.fetchImplementation(url, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      const body = (await response.text())
        .replaceAll(/\s+/g, " ")
        .slice(0, 500);
      throw new Error(
        `Google API request failed with HTTP ${String(response.status)}: ${body}`,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

const headerFormat = (sheetId: number, columns: number): unknown => ({
  repeatCell: {
    range: {
      sheetId,
      startRowIndex: 0,
      endRowIndex: 1,
      startColumnIndex: 0,
      endColumnIndex: columns,
    },
    cell: {
      userEnteredFormat: {
        backgroundColor: { red: 0.08, green: 0.2, blue: 0.38 },
        textFormat: {
          bold: true,
          foregroundColor: { red: 1, green: 1, blue: 1 },
        },
        horizontalAlignment: "CENTER",
        verticalAlignment: "MIDDLE",
        wrapStrategy: "WRAP",
      },
    },
    fields: "userEnteredFormat",
  },
});

const columnWidth = (
  sheetId: number,
  columnIndex: number,
  pixelSize: number,
): unknown => ({
  updateDimensionProperties: {
    range: {
      sheetId,
      dimension: "COLUMNS",
      startIndex: columnIndex,
      endIndex: columnIndex + 1,
    },
    properties: { pixelSize },
    fields: "pixelSize",
  },
});

function exactHeaders(
  actual: readonly (readonly unknown[])[],
  expected: readonly string[],
): boolean {
  return expected.every((header, index) => actual[0]?.[index] === header);
}

function requiredSheetId(
  ids: ReadonlyMap<string, number>,
  title: string,
): number {
  const sheetId = ids.get(title);
  if (sheetId === undefined) {
    throw new Error(`Google Sheets did not return sheet ID for ${title}`);
  }
  return sheetId;
}

export async function createJobSearchWorkbook(
  api: JobWorkbookApi,
  options: CreateJobWorkbookOptions,
): Promise<CreatedJobWorkbook> {
  const created = await api.createSpreadsheet({
    properties: {
      title: options.title,
      locale: "en_US",
      timeZone: "Asia/Kolkata",
    },
    sheets: [
      {
        properties: {
          title: JOB_PIPELINE_SHEET,
          gridProperties: {
            rowCount: 1000,
            columnCount: JOB_PIPELINE_HEADERS.length,
            frozenRowCount: 1,
          },
        },
      },
      {
        properties: {
          title: JOB_SOURCES_SHEET,
          gridProperties: {
            rowCount: 200,
            columnCount: JOB_SOURCE_HEADERS.length,
            frozenRowCount: 1,
          },
        },
      },
      {
        properties: {
          title: JOB_RUNS_SHEET,
          gridProperties: {
            rowCount: 1000,
            columnCount: JOB_RUN_HEADERS.length,
            frozenRowCount: 1,
          },
        },
      },
      {
        properties: {
          title: JOB_PROFILE_SHEET,
          gridProperties: { rowCount: 100, columnCount: 2, frozenRowCount: 1 },
        },
      },
      {
        properties: {
          title: JOB_COMPANIES_SHEET,
          gridProperties: {
            rowCount: 2000,
            columnCount: JOB_COMPANY_HEADERS.length,
            frozenRowCount: 1,
          },
        },
      },
    ],
  });
  const spreadsheetId = created.spreadsheetId;
  if (spreadsheetId === undefined || spreadsheetId === "") {
    throw new Error("Google Sheets did not return a spreadsheet ID");
  }
  const spreadsheetUrl =
    created.spreadsheetUrl ??
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  const ids = new Map(
    (created.sheets ?? []).flatMap((sheet) => {
      const title = sheet.properties?.title;
      const sheetId = sheet.properties?.sheetId;
      return title === undefined || sheetId === undefined
        ? []
        : [[title, sheetId] as const];
    }),
  );
  for (const title of [
    JOB_PIPELINE_SHEET,
    JOB_SOURCES_SHEET,
    JOB_RUNS_SHEET,
    JOB_PROFILE_SHEET,
    JOB_COMPANIES_SHEET,
  ]) {
    if (!ids.has(title))
      throw new Error(`Google Sheets did not return sheet ID for ${title}`);
  }

  const profileRows = [
    ["Field", "Value"],
    ["Profile ID", options.profile.id],
    ["Name", options.profile.name],
    ["Description", options.profile.description],
    ["Target", options.profile.targetEntity],
    ["Geography priority", options.profile.geographyPriority.join("\n")],
    ["Keep threshold", options.profile.thresholds.keep],
    ["Action threshold", options.profile.thresholds.action],
  ];
  await api.batchUpdateValues(spreadsheetId, [
    { range: `'${JOB_PIPELINE_SHEET}'!A1:W1`, values: [JOB_PIPELINE_HEADERS] },
    {
      range: `'${JOB_SOURCES_SHEET}'!A1:H${String(JOB_SOURCE_ROWS.length + 1)}`,
      values: [JOB_SOURCE_HEADERS, ...JOB_SOURCE_ROWS],
    },
    { range: `'${JOB_RUNS_SHEET}'!A1:H1`, values: [JOB_RUN_HEADERS] },
    {
      range: `'${JOB_COMPANIES_SHEET}'!A1:X1`,
      values: [JOB_COMPANY_HEADERS],
    },
    {
      range: `'${JOB_PROFILE_SHEET}'!A1:B${String(profileRows.length)}`,
      values: profileRows,
    },
  ]);

  const pipelineId = requiredSheetId(ids, JOB_PIPELINE_SHEET);
  const sourcesId = requiredSheetId(ids, JOB_SOURCES_SHEET);
  const runsId = requiredSheetId(ids, JOB_RUNS_SHEET);
  const profileId = requiredSheetId(ids, JOB_PROFILE_SHEET);
  const companiesId = requiredSheetId(ids, JOB_COMPANIES_SHEET);
  const widths = [
    130, 230, 180, 260, 105, 170, 115, 150, 145, 145, 220, 150, 180, 180, 80,
    90, 300, 80, 115, 120, 180, 280, 260,
  ];
  await api.batchUpdateSpreadsheet(spreadsheetId, [
    headerFormat(pipelineId, JOB_PIPELINE_HEADERS.length),
    headerFormat(sourcesId, JOB_SOURCE_HEADERS.length),
    headerFormat(runsId, JOB_RUN_HEADERS.length),
    headerFormat(profileId, 2),
    headerFormat(companiesId, JOB_COMPANY_HEADERS.length),
    ...widths.map((width, index) => columnWidth(pipelineId, index, width)),
    ...[120, 190, 110, 360, 230, 80, 130, 300].map((width, index) =>
      columnWidth(sourcesId, index, width),
    ),
    columnWidth(profileId, 0, 180),
    columnWidth(profileId, 1, 600),
    ...[
      150, 190, 90, 100, 110, 120, 230, 220, 240, 220, 220, 220, 200, 190, 240,
      210, 260, 220, 260, 100, 180, 240, 170, 320,
    ].map((width, index) => columnWidth(companiesId, index, width)),
    {
      repeatCell: {
        range: {
          sheetId: pipelineId,
          startRowIndex: 1,
          endRowIndex: 1000,
          startColumnIndex: 0,
          endColumnIndex: JOB_PIPELINE_HEADERS.length,
        },
        cell: {
          userEnteredFormat: { verticalAlignment: "TOP", wrapStrategy: "WRAP" },
        },
        fields: "userEnteredFormat(verticalAlignment,wrapStrategy)",
      },
    },
    {
      repeatCell: {
        range: {
          sheetId: companiesId,
          startRowIndex: 1,
          endRowIndex: 2000,
          startColumnIndex: 0,
          endColumnIndex: JOB_COMPANY_HEADERS.length,
        },
        cell: {
          userEnteredFormat: { verticalAlignment: "TOP", wrapStrategy: "WRAP" },
        },
        fields: "userEnteredFormat(verticalAlignment,wrapStrategy)",
      },
    },
    {
      setDataValidation: {
        range: {
          sheetId: pipelineId,
          startRowIndex: 1,
          endRowIndex: 1000,
          startColumnIndex: 15,
          endColumnIndex: 16,
        },
        rule: {
          condition: {
            type: "ONE_OF_LIST",
            values: ["action", "keep", "hold", "reject"].map(
              (userEnteredValue) => ({ userEnteredValue }),
            ),
          },
          strict: true,
          showCustomUi: true,
        },
      },
    },
    {
      setDataValidation: {
        range: {
          sheetId: pipelineId,
          startRowIndex: 1,
          endRowIndex: 1000,
          startColumnIndex: 17,
          endColumnIndex: 18,
        },
        rule: {
          condition: { type: "BOOLEAN" },
          strict: true,
          showCustomUi: true,
        },
      },
    },
    {
      setDataValidation: {
        range: {
          sheetId: pipelineId,
          startRowIndex: 1,
          endRowIndex: 1000,
          startColumnIndex: 19,
          endColumnIndex: 20,
        },
        rule: {
          condition: {
            type: "ONE_OF_LIST",
            values: [
              "Discovered",
              "Shortlisted",
              "Applying",
              "Applied",
              "Interview",
              "Offer",
              "Rejected",
              "Withdrawn",
              "Closed",
            ].map((userEnteredValue) => ({ userEnteredValue })),
          },
          strict: true,
          showCustomUi: true,
        },
      },
    },
  ]);

  await api.shareSpreadsheet(spreadsheetId, options.shareWith);
  const [pipeline, sources, runs, profile, companies] = await Promise.all([
    api.getValues(spreadsheetId, `'${JOB_PIPELINE_SHEET}'!A1:W1`),
    api.getValues(spreadsheetId, `'${JOB_SOURCES_SHEET}'!A1:H1`),
    api.getValues(spreadsheetId, `'${JOB_RUNS_SHEET}'!A1:H1`),
    api.getValues(spreadsheetId, `'${JOB_PROFILE_SHEET}'!A1:B1`),
    api.getValues(spreadsheetId, `'${JOB_COMPANIES_SHEET}'!A1:X1`),
  ]);
  const verified =
    exactHeaders(pipeline, JOB_PIPELINE_HEADERS) &&
    exactHeaders(sources, JOB_SOURCE_HEADERS) &&
    exactHeaders(runs, JOB_RUN_HEADERS) &&
    exactHeaders(profile, ["Field", "Value"]) &&
    exactHeaders(companies, JOB_COMPANY_HEADERS);
  if (!verified) throw new Error("Job workbook read-back verification failed");
  return {
    spreadsheetId,
    spreadsheetUrl,
    sharedWith: options.shareWith,
    sheets: [
      JOB_PIPELINE_SHEET,
      JOB_SOURCES_SHEET,
      JOB_RUNS_SHEET,
      JOB_PROFILE_SHEET,
      JOB_COMPANIES_SHEET,
    ],
    verified,
  };
}
