import type { GoogleSheetsWorkbookTransport } from "../integrations/google-sheets.js";
import type { ScoutProfile } from "../profiles/schema.js";
import {
  JOB_COMPANIES_SHEET,
  JOB_COMPANY_HEADERS,
  JOB_PIPELINE_HEADERS,
  JOB_PIPELINE_SHEET,
  JOB_PROFILE_SHEET,
  JOB_RUN_HEADERS,
  JOB_RUNS_SHEET,
  JOB_SOURCE_HEADERS,
  JOB_SOURCE_ROWS,
  JOB_SOURCES_SHEET,
} from "./google-workbook.js";

interface SheetMetadata {
  sheets?: { properties?: { sheetId?: number; title?: string } }[];
}

export interface InitializeJobWorkbookResult {
  spreadsheetId: string;
  spreadsheetUrl: string;
  createdSheets: readonly string[];
  sheets: readonly string[];
  verified: boolean;
}

function sheetMap(metadata: SheetMetadata): Map<string, number> {
  return new Map(
    (metadata.sheets ?? []).flatMap((sheet) => {
      const title = sheet.properties?.title;
      const sheetId = sheet.properties?.sheetId;
      return title === undefined || sheetId === undefined
        ? []
        : [[title, sheetId] as const];
    }),
  );
}

function requiredSheetId(
  ids: ReadonlyMap<string, number>,
  title: string,
): number {
  const sheetId = ids.get(title);
  if (sheetId === undefined) throw new Error(`Missing sheet ${title}`);
  return sheetId;
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

function headersMatch(
  rows: readonly (readonly unknown[])[],
  expected: readonly string[],
): boolean {
  return expected.every((header, index) => rows[0]?.[index] === header);
}

const sourceId = (value: unknown): string =>
  typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";

export async function initializeJobSearchWorkbook(
  transport: GoogleSheetsWorkbookTransport,
  spreadsheetId: string,
  profile: ScoutProfile,
): Promise<InitializeJobWorkbookResult> {
  const initial = await transport.getSpreadsheet<SheetMetadata>(
    "sheets(properties(sheetId,title))",
  );
  const initialIds = sheetMap(initial);
  const initialEntries = [...initialIds.entries()];
  if (initialEntries.length === 0) throw new Error("Workbook has no sheets");

  const createRequests: unknown[] = [];
  const createdSheets: string[] = [];
  if (!initialIds.has(JOB_PIPELINE_SHEET)) {
    const first = initialEntries[0];
    if (first === undefined) throw new Error("Workbook has no first sheet");
    createRequests.push({
      updateSheetProperties: {
        properties: {
          sheetId: first[1],
          title: JOB_PIPELINE_SHEET,
          gridProperties: {
            rowCount: 1000,
            columnCount: JOB_PIPELINE_HEADERS.length,
            frozenRowCount: 1,
          },
        },
        fields: "title,gridProperties(rowCount,columnCount,frozenRowCount)",
      },
    });
    createdSheets.push(JOB_PIPELINE_SHEET);
  }
  const desired = [
    [JOB_SOURCES_SHEET, 200, JOB_SOURCE_HEADERS.length],
    [JOB_RUNS_SHEET, 1000, JOB_RUN_HEADERS.length],
    [JOB_PROFILE_SHEET, 100, 2],
    [JOB_COMPANIES_SHEET, 2000, JOB_COMPANY_HEADERS.length],
  ] as const;
  for (const [title, rowCount, columnCount] of desired) {
    if (initialIds.has(title)) continue;
    createRequests.push({
      addSheet: {
        properties: {
          title,
          gridProperties: { rowCount, columnCount, frozenRowCount: 1 },
        },
      },
    });
    createdSheets.push(title);
  }
  if (createRequests.length > 0) {
    await transport.batchUpdateSpreadsheet(createRequests);
  }

  const metadata = await transport.getSpreadsheet<SheetMetadata>(
    "sheets(properties(sheetId,title))",
  );
  const ids = sheetMap(metadata);
  const pipelineId = requiredSheetId(ids, JOB_PIPELINE_SHEET);
  const sourcesId = requiredSheetId(ids, JOB_SOURCES_SHEET);
  const runsId = requiredSheetId(ids, JOB_RUNS_SHEET);
  const profileId = requiredSheetId(ids, JOB_PROFILE_SHEET);
  const companiesId = requiredSheetId(ids, JOB_COMPANIES_SHEET);
  const existingSourceRows = await transport.getValues(
    `'${JOB_SOURCES_SHEET}'!A2:H200`,
  );
  const profileRows = [
    ["Field", "Value"],
    ["Profile ID", profile.id],
    ["Name", profile.name],
    ["Description", profile.description],
    ["Target", profile.targetEntity],
    ["Geography priority", profile.geographyPriority.join("\n")],
    ["Keep threshold", profile.thresholds.keep],
    ["Action threshold", profile.thresholds.action],
  ];
  const updates: {
    range: string;
    values: readonly (readonly unknown[])[];
  }[] = [
    { range: `'${JOB_PIPELINE_SHEET}'!A1:W1`, values: [JOB_PIPELINE_HEADERS] },
    { range: `'${JOB_SOURCES_SHEET}'!A1:H1`, values: [JOB_SOURCE_HEADERS] },
    { range: `'${JOB_RUNS_SHEET}'!A1:H1`, values: [JOB_RUN_HEADERS] },
    {
      range: `'${JOB_COMPANIES_SHEET}'!A1:X1`,
      values: [JOB_COMPANY_HEADERS],
    },
    {
      range: `'${JOB_PROFILE_SHEET}'!A1:B${String(profileRows.length)}`,
      values: profileRows,
    },
  ];
  const existingSourceIds = new Set(
    existingSourceRows.map((row) => sourceId(row[0])),
  );
  const missingSourceRows = JOB_SOURCE_ROWS.filter(
    (row) => !existingSourceIds.has(row[0]),
  );
  if (missingSourceRows.length > 0) {
    const firstEmptyIndex = existingSourceRows.findIndex(
      (row) => sourceId(row[0]) === "",
    );
    const firstRow =
      2 + (firstEmptyIndex < 0 ? existingSourceRows.length : firstEmptyIndex);
    updates.push({
      range: `'${JOB_SOURCES_SHEET}'!A${String(firstRow)}:H${String(firstRow + missingSourceRows.length - 1)}`,
      values: missingSourceRows,
    });
  }
  for (const sourceRow of JOB_SOURCE_ROWS) {
    const existingIndex = existingSourceRows.findIndex(
      (row) => sourceId(row[0]) === sourceRow[0],
    );
    if (existingIndex < 0) continue;
    const rowNumber = existingIndex + 2;
    updates.push(
      {
        range: `'${JOB_SOURCES_SHEET}'!A${String(rowNumber)}:E${String(rowNumber)}`,
        values: [[...sourceRow.slice(0, 5)]],
      },
      {
        range: `'${JOB_SOURCES_SHEET}'!H${String(rowNumber)}:H${String(rowNumber)}`,
        values: [[sourceRow[7]]],
      },
    );
  }
  await transport.batchUpdateValues(updates);

  const pipelineWidths = [
    130, 230, 180, 260, 105, 170, 115, 150, 145, 145, 220, 150, 180, 180, 80,
    90, 300, 80, 115, 120, 180, 280, 260,
  ];
  await transport.batchUpdateSpreadsheet([
    headerFormat(pipelineId, JOB_PIPELINE_HEADERS.length),
    headerFormat(sourcesId, JOB_SOURCE_HEADERS.length),
    headerFormat(runsId, JOB_RUN_HEADERS.length),
    headerFormat(profileId, 2),
    headerFormat(companiesId, JOB_COMPANY_HEADERS.length),
    ...pipelineWidths.map((width, index) =>
      columnWidth(pipelineId, index, width),
    ),
    ...[120, 190, 110, 360, 230, 80, 170, 300].map((width, index) =>
      columnWidth(sourcesId, index, width),
    ),
    ...[280, 190, 190, 90, 120, 80, 80, 360].map((width, index) =>
      columnWidth(runsId, index, width),
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
          sheetId: sourcesId,
          startRowIndex: 1,
          endRowIndex: 200,
          startColumnIndex: 0,
          endColumnIndex: JOB_SOURCE_HEADERS.length,
        },
        cell: {
          userEnteredFormat: {
            verticalAlignment: "TOP",
            wrapStrategy: "WRAP",
          },
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
          userEnteredFormat: {
            verticalAlignment: "TOP",
            wrapStrategy: "WRAP",
          },
        },
        fields: "userEnteredFormat(verticalAlignment,wrapStrategy)",
      },
    },
    {
      repeatCell: {
        range: {
          sheetId: runsId,
          startRowIndex: 1,
          endRowIndex: 1000,
          startColumnIndex: 0,
          endColumnIndex: JOB_RUN_HEADERS.length,
        },
        cell: {
          userEnteredFormat: {
            verticalAlignment: "TOP",
            wrapStrategy: "WRAP",
          },
        },
        fields: "userEnteredFormat(verticalAlignment,wrapStrategy)",
      },
    },
    {
      updateDimensionProperties: {
        range: {
          sheetId: runsId,
          dimension: "ROWS",
          startIndex: 1,
          endIndex: 1000,
        },
        properties: { pixelSize: 48 },
        fields: "pixelSize",
      },
    },
    {
      updateDimensionProperties: {
        range: {
          sheetId: sourcesId,
          dimension: "ROWS",
          startIndex: 1,
          endIndex: 200,
        },
        properties: { pixelSize: 58 },
        fields: "pixelSize",
      },
    },
    {
      repeatCell: {
        range: {
          sheetId: profileId,
          startRowIndex: 1,
          endRowIndex: profileRows.length,
          startColumnIndex: 0,
          endColumnIndex: 2,
        },
        cell: {
          userEnteredFormat: {
            verticalAlignment: "TOP",
            wrapStrategy: "WRAP",
          },
        },
        fields: "userEnteredFormat(verticalAlignment,wrapStrategy)",
      },
    },
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
          userEnteredFormat: {
            verticalAlignment: "TOP",
            wrapStrategy: "WRAP",
          },
        },
        fields: "userEnteredFormat(verticalAlignment,wrapStrategy)",
      },
    },
    {
      updateDimensionProperties: {
        range: {
          sheetId: pipelineId,
          dimension: "ROWS",
          startIndex: 1,
          endIndex: 1000,
        },
        properties: { pixelSize: 76 },
        fields: "pixelSize",
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

  const [pipeline, sources, runs, profileValues, companies] = await Promise.all(
    [
      transport.getValues(`'${JOB_PIPELINE_SHEET}'!A1:W1`),
      transport.getValues(`'${JOB_SOURCES_SHEET}'!A1:H1`),
      transport.getValues(`'${JOB_RUNS_SHEET}'!A1:H1`),
      transport.getValues(`'${JOB_PROFILE_SHEET}'!A1:B1`),
      transport.getValues(`'${JOB_COMPANIES_SHEET}'!A1:X1`),
    ],
  );
  const verified =
    headersMatch(pipeline, JOB_PIPELINE_HEADERS) &&
    headersMatch(sources, JOB_SOURCE_HEADERS) &&
    headersMatch(runs, JOB_RUN_HEADERS) &&
    headersMatch(profileValues, ["Field", "Value"]) &&
    headersMatch(companies, JOB_COMPANY_HEADERS);
  if (!verified) throw new Error("Job workbook read-back verification failed");
  return {
    spreadsheetId,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    createdSheets,
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
