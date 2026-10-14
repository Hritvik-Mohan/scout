import type { GoogleSheetsWorkbookTransport } from "../integrations/google-sheets.js";
import { normalizeEmail } from "../core/dedup.js";
import {
  buildOutreachPlan,
  JOB_OUTREACH_HEADERS,
  JOB_OUTREACH_SHEET,
  localDay,
  OUTREACH_STATUSES,
  outreachRows,
  type CreatedOutreachDraft,
  type OutreachPlan,
} from "./outreach.js";
import { JobReviewSheetRepository } from "./review-sheet.js";
import { pipelineEntries } from "./review.js";

interface SheetMetadata {
  sheets?: { properties?: { sheetId?: number; title?: string } }[];
}

interface AddSheetResponse {
  replies?: { addSheet?: { properties?: { sheetId?: number } } }[];
}

const STATUS_COLUMN = JOB_OUTREACH_HEADERS.indexOf("Status");

export class JobOutreachSheetRepository {
  constructor(private readonly transport: GoogleSheetsWorkbookTransport) {}

  /**
   * Creates the Outreach tab on first use and keeps its header row and Status
   * list current, so an older tab picks up new columns and statuses.
   */
  async ensureSheet(): Promise<void> {
    const metadata = await this.transport.getSpreadsheet<SheetMetadata>(
      "sheets(properties(sheetId,title))",
    );
    let sheetId = (metadata.sheets ?? []).find(
      (sheet) => sheet.properties?.title === JOB_OUTREACH_SHEET,
    )?.properties?.sheetId;
    if (sheetId === undefined) {
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
      sheetId = created.replies?.[0]?.addSheet?.properties?.sheetId;
    }
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
    await this.transport.batchUpdateValues([
      {
        range: `'${JOB_OUTREACH_SHEET}'!A1:M1`,
        values: [JOB_OUTREACH_HEADERS],
      },
    ]);
  }

  rows(): Promise<readonly (readonly unknown[])[]> {
    return this.transport.getValues(`'${JOB_OUTREACH_SHEET}'!A2:M1000`);
  }

  /** Outreach rows for read-only reports, or none when the tab is missing. */
  rowsIfPresent(): Promise<readonly (readonly unknown[])[]> {
    return this.rows().catch(() => []);
  }

  async appendContacts(rows: readonly (readonly string[])[]): Promise<void> {
    if (rows.length === 0) return;
    await this.transport.appendValues(`'${JOB_OUTREACH_SHEET}'!A:M`, rows);
  }

  /**
   * Stamps Draft Created (column L) for contacts whose Gmail draft now exists.
   * A row is skipped when its address no longer matches, so a re-sorted tab is
   * never stamped on the wrong contact.
   */
  async recordDrafts(
    created: readonly CreatedOutreachDraft[],
    createdOn: string,
  ): Promise<{ recorded: number; mismatched: readonly number[] }> {
    const rows = new Map(
      outreachRows(await this.rows()).map((row) => [row.rowNumber, row]),
    );
    const matched = created.filter(
      (draft) => normalizeEmail(rows.get(draft.rowNumber)?.email) === draft.to,
    );
    if (matched.length > 0) {
      await this.transport.batchUpdateValues(
        matched.map((draft) => ({
          range: `'${JOB_OUTREACH_SHEET}'!L${String(draft.rowNumber)}`,
          values: [[createdOn]],
        })),
      );
    }
    return {
      recorded: matched.length,
      mismatched: created
        .filter((draft) => !matched.includes(draft))
        .map((draft) => draft.rowNumber),
    };
  }
}

/** Reads the Outreach tab and Job Pipeline and builds today's batch. */
export async function loadOutreachPlan(
  transport: GoogleSheetsWorkbookTransport,
  options: { now: Date; cap: number; perCompany: number },
): Promise<OutreachPlan> {
  const outreach = new JobOutreachSheetRepository(transport);
  await outreach.ensureSheet();
  return buildOutreachPlan(
    await outreach.rows(),
    pipelineEntries(
      await new JobReviewSheetRepository(transport).pipelineRows(),
      options.now,
    ),
    {
      today: localDay(options.now),
      cap: options.cap,
      perCompany: options.perCompany,
    },
  );
}
