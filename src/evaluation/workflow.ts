import {
  a1CodexResultSchema,
  a1PreparedBatchSchema,
  type A1CodexResult,
  type A1PreparedBatch,
} from "../agents/a1-codex.js";
import type {
  GoogleSheetsWorkbookTransport,
  SheetValueUpdate,
} from "../integrations/google-sheets.js";

export const EVALUATION_REVIEW_SHEET = "Evaluation Review (Blind)";
export const EVALUATION_REVIEW_HEADERS = [
  "Case ID",
  "Source",
  "Published Date",
  "Article Title",
  "Evidence URL",
  "Source Summary",
  "A1 Decision",
  "A1 Company",
  "A1 Website",
  "A1 Signal",
  "A1 Reason",
  "Human Verdict",
  "Human Fit (1-5)",
  "Company Correct",
  "Signal Correct",
  "Website Correct",
  "Evidence Resolves",
  "Evidence Supports",
  "Duplicate Of",
  "DNC Violation",
  "Review Seconds",
  "Reject Reasons",
  "Review Notes",
] as const;

interface SheetMetadata {
  sheets?: {
    properties?: { sheetId?: number; title?: string };
    tables?: { tableId?: string; name?: string }[];
  }[];
}

interface BatchUpdateReply {
  replies?: { addSheet?: { properties?: { sheetId?: number } } }[];
}

export interface EvaluationPublishResult {
  sheetId: number;
  created: boolean;
  cases: number;
  humanCellsPreserved: boolean;
  verified: boolean;
}

const cleanHtml = (value: string): string =>
  value
    .replaceAll("&#8217;", "’")
    .replaceAll("&#038;", "&")
    .replaceAll("&amp;", "&")
    .replaceAll(/<[^>]+>/g, "")
    .trim();

const cellText = (value: unknown): string => {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
};

export function validateEvaluationInputs(
  unparsedBatch: unknown,
  unparsedResult: unknown,
): { batch: A1PreparedBatch; result: A1CodexResult } {
  const batch = a1PreparedBatchSchema.parse(unparsedBatch);
  const result = a1CodexResultSchema.parse(unparsedResult);
  if (batch.documents.length !== 100) {
    throw new Error(
      "The frozen evaluation batch must contain exactly 100 documents",
    );
  }
  if (result.batchId !== batch.batchId) {
    throw new Error(
      "Evaluation A1 result batchId does not match the frozen batch",
    );
  }
  const expected = new Set(
    batch.documents.map((document) => document.documentId),
  );
  const received = new Set(
    result.decisions.map((decision) => decision.documentId),
  );
  if (received.size !== 100 || expected.size !== received.size) {
    throw new Error(
      "Evaluation requires exactly one unique A1 decision per document",
    );
  }
  for (const documentId of expected) {
    if (!received.has(documentId)) {
      throw new Error(`Missing A1 decision for ${documentId}`);
    }
  }
  return { batch, result };
}

export function buildBlindReviewRows(
  batch: A1PreparedBatch,
  result: A1CodexResult,
): readonly (readonly unknown[])[] {
  const decisions = new Map(
    result.decisions.map((decision) => [decision.documentId, decision]),
  );
  return batch.documents.map((document, index) => {
    const decision = decisions.get(document.documentId);
    if (decision === undefined)
      throw new Error(`Missing decision for ${document.documentId}`);
    const accepted = decision.status === "accepted" ? decision.candidate : null;
    return [
      `EVAL-20261007-${String(index + 1).padStart(3, "0")}`,
      document.sourceId,
      document.publishedAt.slice(0, 10),
      cleanHtml(document.title),
      document.url,
      cleanHtml(document.summary ?? ""),
      decision.status === "accepted" ? "Accepted" : "Rejected",
      accepted?.company ?? "",
      accepted?.website ?? "",
      accepted?.signal ?? "",
      accepted?.reason ??
        (decision.status === "rejected" ? decision.detail : ""),
      "",
      "",
      "",
      "",
      accepted?.website === null ? "N/A" : "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ];
  });
}

const dropdownColumn = (
  columnIndex: number,
  columnName: string,
  values: readonly string[],
): Record<string, unknown> => ({
  columnIndex,
  columnName,
  columnType: "DROPDOWN",
  dataValidationRule: {
    condition: {
      type: "ONE_OF_LIST",
      values: values.map((userEnteredValue) => ({ userEnteredValue })),
    },
  },
});

const tableColumns = EVALUATION_REVIEW_HEADERS.map(
  (columnName, columnIndex) => {
    if (columnIndex === 11)
      return dropdownColumn(columnIndex, columnName, [
        "Qualified",
        "Plausible",
        "Reject",
      ]);
    if ([13, 14, 16, 17, 19].includes(columnIndex))
      return dropdownColumn(columnIndex, columnName, ["Yes", "No"]);
    if (columnIndex === 15)
      return dropdownColumn(columnIndex, columnName, ["Yes", "No", "N/A"]);
    return {
      columnIndex,
      columnName,
      columnType: columnIndex === 12 || columnIndex === 20 ? "DOUBLE" : "TEXT",
    };
  },
);

const columnWidths = [
  145, 170, 105, 310, 260, 340, 100, 170, 190, 155, 300, 125, 105, 120, 115,
  120, 130, 130, 140, 110, 110, 220, 260,
];

export class EvaluationReviewSheet {
  constructor(private readonly transport: GoogleSheetsWorkbookTransport) {}

  async publish(
    unparsedBatch: unknown,
    unparsedResult: unknown,
  ): Promise<EvaluationPublishResult> {
    const { batch, result } = validateEvaluationInputs(
      unparsedBatch,
      unparsedResult,
    );
    const rows = buildBlindReviewRows(batch, result);
    const metadata = await this.transport.getSpreadsheet<SheetMetadata>(
      "sheets(properties(sheetId,title),tables(tableId,name))",
    );
    const existing = metadata.sheets?.find(
      (sheet) => sheet.properties?.title === EVALUATION_REVIEW_SHEET,
    );
    let sheetId = existing?.properties?.sheetId;
    let created = false;
    if (sheetId === undefined) {
      const reply =
        await this.transport.batchUpdateSpreadsheet<BatchUpdateReply>([
          {
            addSheet: {
              properties: {
                title: EVALUATION_REVIEW_SHEET,
                gridProperties: {
                  rowCount: 101,
                  columnCount: EVALUATION_REVIEW_HEADERS.length,
                  frozenRowCount: 1,
                },
              },
            },
          },
        ]);
      sheetId = reply.replies?.[0]?.addSheet?.properties?.sheetId;
      if (sheetId === undefined)
        throw new Error("Google Sheets did not return the evaluation sheet ID");
      created = true;
    }

    const updates: SheetValueUpdate[] = [
      {
        range: `'${EVALUATION_REVIEW_SHEET}'!A1:W1`,
        values: [EVALUATION_REVIEW_HEADERS],
      },
      {
        range: `'${EVALUATION_REVIEW_SHEET}'!A2:K101`,
        values: rows.map((row) => row.slice(0, 11)),
      },
    ];
    if (created) {
      updates.push({
        range: `'${EVALUATION_REVIEW_SHEET}'!L2:W101`,
        values: rows.map((row) => row.slice(11)),
      });
    }
    await this.transport.batchUpdateValues(updates);

    const structuralRequests: unknown[] = [
      {
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: 23,
          },
          cell: {
            userEnteredFormat: {
              backgroundColorStyle: {
                rgbColor: { red: 0.12, green: 0.24, blue: 0.42 },
              },
              textFormat: {
                bold: true,
                foregroundColorStyle: {
                  rgbColor: { red: 1, green: 1, blue: 1 },
                },
              },
              wrapStrategy: "WRAP",
            },
          },
          fields:
            "userEnteredFormat(backgroundColorStyle,textFormat,wrapStrategy)",
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 },
          properties: { pixelSize: 42 },
          fields: "pixelSize",
        },
      },
      ...columnWidths.map((pixelSize, columnIndex) => ({
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
      })),
      {
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 1,
            endRowIndex: 101,
            startColumnIndex: 3,
            endColumnIndex: 11,
          },
          cell: {
            userEnteredFormat: {
              wrapStrategy: "WRAP",
              verticalAlignment: "TOP",
            },
          },
          fields: "userEnteredFormat(wrapStrategy,verticalAlignment)",
        },
      },
    ];
    if (created) {
      structuralRequests.push(
        {
          addProtectedRange: {
            protectedRange: {
              range: {
                sheetId,
                startRowIndex: 0,
                endRowIndex: 101,
                startColumnIndex: 0,
                endColumnIndex: 11,
              },
              description:
                "A1 evaluation evidence and decisions; human reviewers edit L:W only.",
              warningOnly: true,
            },
          },
        },
        {
          addTable: {
            table: {
              name: "A1BlindEvaluationReview",
              range: {
                sheetId,
                startRowIndex: 0,
                endRowIndex: 101,
                startColumnIndex: 0,
                endColumnIndex: 23,
              },
              columnProperties: tableColumns,
            },
          },
        },
      );
    }
    await this.transport.batchUpdateSpreadsheet(structuralRequests);
    const verification = await this.transport.getValues(
      `'${EVALUATION_REVIEW_SHEET}'!A1:W101`,
    );
    if (
      verification.length !== 101 ||
      EVALUATION_REVIEW_HEADERS.some(
        (header, index) => cellText(verification[0]?.[index]) !== header,
      ) ||
      rows.some(
        (row, index) =>
          cellText(verification[index + 1]?.[0]) !== cellText(row[0]),
      )
    ) {
      throw new Error("Evaluation Review read-back verification failed");
    }
    return {
      sheetId,
      created,
      cases: rows.length,
      humanCellsPreserved: !created,
      verified: true,
    };
  }
}
