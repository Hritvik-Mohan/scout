import type {
  GoogleSheetsWorkbookTransport,
  SheetValueUpdate,
} from "../integrations/google-sheets.js";
import { fitSummary, type JobReview } from "./review.js";

export const JOB_APPLICATION_KIT_SHEET = "Application Kit";

export const JOB_APPLICATION_KIT_HEADERS = [
  "Opportunity ID",
  "Company",
  "Role",
  "Source URL",
  "Fit",
  "Verdict",
  "Lead With",
  "Outreach Draft (not sent)",
  "Reviewed",
  "Referral Path",
] as const;

const text = (value: unknown): string => {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
};

interface SheetMetadata {
  sheets?: { properties?: { title?: string } }[];
}

export interface ApplyReviewsResult {
  applied: number;
  unknownIds: readonly string[];
}

export class JobReviewSheetRepository {
  constructor(private readonly transport: GoogleSheetsWorkbookTransport) {}

  pipelineRows(): Promise<readonly (readonly unknown[])[]> {
    return this.transport.getValues("'Job Pipeline'!A2:AA1000");
  }

  private async ensureKitSheet(): Promise<void> {
    const metadata = await this.transport.getSpreadsheet<SheetMetadata>(
      "sheets(properties(title))",
    );
    const exists = (metadata.sheets ?? []).some(
      (sheet) => sheet.properties?.title === JOB_APPLICATION_KIT_SHEET,
    );
    if (!exists) {
      await this.transport.batchUpdateSpreadsheet([
        {
          addSheet: {
            properties: {
              title: JOB_APPLICATION_KIT_SHEET,
              gridProperties: { frozenRowCount: 1 },
            },
          },
        },
      ]);
    }
    await this.transport.batchUpdateValues([
      {
        range: `'${JOB_APPLICATION_KIT_SHEET}'!A1:J1`,
        values: [JOB_APPLICATION_KIT_HEADERS],
      },
    ]);
  }

  /** Clears Application Kit rows for roles removed from the pipeline. */
  async removeDrafts(opportunityIds: readonly string[]): Promise<number> {
    if (opportunityIds.length === 0) return 0;
    const kit = await this.transport
      .getValues(`'${JOB_APPLICATION_KIT_SHEET}'!A2:A1000`)
      .catch(() => []);
    const updates = kit.flatMap((row, index) =>
      opportunityIds.includes(text(row[0]).trim())
        ? [
            {
              range: `'${JOB_APPLICATION_KIT_SHEET}'!A${String(index + 2)}:J${String(index + 2)}`,
              values: [Array.from({ length: 10 }, () => "")],
            },
          ]
        : [],
    );
    if (updates.length > 0) await this.transport.batchUpdateValues(updates);
    return updates.length;
  }

  /**
   * Writes review columns X:AA on matching Job Pipeline rows and upserts the
   * drafts into Application Kit. Human columns R:V are never written.
   */
  async applyReviews(
    reviews: readonly JobReview[],
    reviewedAt: string,
  ): Promise<ApplyReviewsResult> {
    const pipeline = await this.pipelineRows();
    await this.ensureKitSheet();
    const kit = await this.transport.getValues(
      `'${JOB_APPLICATION_KIT_SHEET}'!A2:I1000`,
    );
    const kitIds = kit.map((row) => text(row[0]).trim());
    while (kitIds.at(-1) === "") kitIds.pop();
    const updates: SheetValueUpdate[] = [];
    const unknownIds: string[] = [];
    let applied = 0;
    for (const review of reviews) {
      const rowIndex = pipeline.findIndex((row) => row[0] === review.id);
      const row = pipeline[rowIndex];
      if (row === undefined) {
        unknownIds.push(review.id);
        continue;
      }
      const rowNumber = rowIndex + 2;
      updates.push({
        range: `'Job Pipeline'!X${String(rowNumber)}:AA${String(rowNumber)}`,
        values: [[review.fit, review.verdict, fitSummary(review), reviewedAt]],
      });
      const kitIndex = kitIds.indexOf(review.id);
      let kitRow = kitIndex + 2;
      if (kitIndex < 0) {
        // Reuse a row cleared by removeDrafts before appending.
        const blank = kitIds.indexOf("");
        if (blank < 0) kitIds.push(review.id);
        else kitIds[blank] = review.id;
        kitRow = (blank < 0 ? kitIds.length - 1 : blank) + 2;
      }
      updates.push({
        range: `'${JOB_APPLICATION_KIT_SHEET}'!A${String(kitRow)}:I${String(kitRow)}`,
        values: [
          [
            review.id,
            text(row[2]),
            text(row[1]),
            text(row[3]),
            review.fit,
            review.verdict,
            review.leadWith.map((item) => `- ${item}`).join("\n"),
            review.outreach,
            reviewedAt,
          ],
        ],
      });
      // An absent referral path leaves any earlier research in place.
      if (review.referralPath !== undefined) {
        updates.push({
          range: `'${JOB_APPLICATION_KIT_SHEET}'!J${String(kitRow)}:J${String(kitRow)}`,
          values: [[review.referralPath]],
        });
      }
      applied += 1;
    }
    if (updates.length > 0) await this.transport.batchUpdateValues(updates);
    return { applied, unknownIds };
  }
}
