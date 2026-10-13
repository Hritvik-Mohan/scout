import type { GoogleSheetsWorkbookTransport } from "../integrations/google-sheets.js";
import {
  JOB_OUTREACH_HEADERS,
  JOB_OUTREACH_SHEET,
  OUTREACH_STATUSES,
} from "./outreach.js";

interface SheetMetadata {
  sheets?: { properties?: { title?: string } }[];
}

interface AddSheetResponse {
  replies?: { addSheet?: { properties?: { sheetId?: number } } }[];
}

const STATUS_COLUMN = JOB_OUTREACH_HEADERS.indexOf("Status");

export class JobOutreachSheetRepository {
  constructor(private readonly transport: GoogleSheetsWorkbookTransport) {}

  /** Creates the Outreach tab on first use and keeps its header row current. */
  async ensureSheet(): Promise<void> {
    const metadata = await this.transport.getSpreadsheet<SheetMetadata>(
      "sheets(properties(title))",
    );
    const exists = (metadata.sheets ?? []).some(
      (sheet) => sheet.properties?.title === JOB_OUTREACH_SHEET,
    );
    if (!exists) {
      const created =
        await this.transport.batchUpdateSpreadsheet<AddSheetResponse>([
          {
            addSheet: {
              properties: {
                title: JOB_OUTREACH_SHEET,
                gridProperties: { frozenRowCount: 1 },
              },
            },
          },
        ]);
      const sheetId = created.replies?.[0]?.addSheet?.properties?.sheetId;
      if (sheetId !== undefined) {
        await this.transport.batchUpdateSpreadsheet([
          {
            setDataValidation: {
              range: {
                sheetId,
                startRowIndex: 1,
                endRowIndex: 1000,
                startColumnIndex: STATUS_COLUMN,
                endColumnIndex: STATUS_COLUMN + 1,
              },
              rule: {
                condition: {
                  type: "ONE_OF_LIST",
                  values: OUTREACH_STATUSES.map((userEnteredValue) => ({
                    userEnteredValue,
                  })),
                },
                strict: true,
                showCustomUi: true,
              },
            },
          },
        ]);
      }
    }
    await this.transport.batchUpdateValues([
      {
        range: `'${JOB_OUTREACH_SHEET}'!A1:K1`,
        values: [JOB_OUTREACH_HEADERS],
      },
    ]);
  }

  rows(): Promise<readonly (readonly unknown[])[]> {
    return this.transport.getValues(`'${JOB_OUTREACH_SHEET}'!A2:K1000`);
  }

  async appendContacts(rows: readonly (readonly string[])[]): Promise<void> {
    if (rows.length === 0) return;
    await this.transport.appendValues(`'${JOB_OUTREACH_SHEET}'!A:K`, rows);
  }
}
