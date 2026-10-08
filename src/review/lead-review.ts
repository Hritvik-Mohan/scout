import { a1ProposedLeadSchema } from "../agents/a1-codex.js";
import { a2ProposedReviewSchema } from "../agents/a2-codex.js";
import type {
  GoogleSheetsTransport,
  SheetValueUpdate,
} from "../integrations/google-sheets.js";
import type { DryRunOutputRow } from "../models/tracker.js";

const SHEET = "'Lead Review'";
const FIRST_DATA_ROW = 2;
const LAST_DATA_ROW = 1000;

export interface LeadReviewSyncResult {
  created: number;
  updated: number;
  unchanged: number;
}

type Contact = NonNullable<
  ReturnType<typeof a2ProposedReviewSchema.parse>["contact"]
>;

interface MaterializedLead {
  leadId: string;
  values: readonly unknown[];
  contact: Contact | undefined;
}

const text = (value: unknown): string => {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
};

const nestedText = (value: unknown, parent: string, child: string): string => {
  if (typeof value !== "object" || value === null || !(parent in value))
    return "";
  const nested = (value as Record<string, unknown>)[parent];
  if (typeof nested !== "object" || nested === null || !(child in nested))
    return "";
  return text((nested as Record<string, unknown>)[child]);
};

const marketLabel = (value: string): string =>
  value === "india"
    ? "India"
    : value === "international"
      ? "International"
      : "Unknown";

const priorityLabel = (value: string): string =>
  value === "india_first"
    ? "India first"
    : value === "international_second"
      ? "International second"
      : "Location unverified";

const emailUsabilityLabel = (contact?: Contact): string => {
  if (contact === undefined) return "Not researched";
  return contact.emailUsability.replaceAll("_", " ");
};

export function materializeLeadReviews(
  outputs: readonly DryRunOutputRow[],
): readonly MaterializedLead[] {
  const leads = new Map<
    string,
    ReturnType<typeof a1ProposedLeadSchema.parse>
  >();
  const reviews = new Map<
    string,
    ReturnType<typeof a2ProposedReviewSchema.parse>
  >();

  for (const output of outputs) {
    if (
      output.agent === "A1" &&
      output.proposedOperation === "create_pipeline_lead"
    ) {
      const parsed = a1ProposedLeadSchema.safeParse(output.proposedValue);
      if (parsed.success) leads.set(parsed.data.leadId, parsed.data);
    }
    if (
      output.agent === "A2" &&
      output.proposedOperation === "verify_and_score_lead"
    ) {
      const parsed = a2ProposedReviewSchema.safeParse(output.proposedValue);
      if (parsed.success) reviews.set(parsed.data.leadId, parsed.data);
    }
  }

  return [...reviews.values()].flatMap((review) => {
    const lead = leads.get(review.leadId);
    if (lead === undefined) return [];
    const whyItFits = [
      nestedText(review.criteria, "icpMatch", "rationale"),
      nestedText(review.criteria, "buyingSignalAndNeed", "rationale"),
    ]
      .filter(Boolean)
      .join(" ");
    const disqualifiers = review.disqualifiers.join(", ");
    const contact = review.contact;
    return [
      {
        leadId: lead.leadId,
        contact,
        values: [
          lead.leadId,
          lead.company,
          lead.website ?? "",
          "",
          marketLabel(review.geography),
          review.icpTier,
          review.fitScore,
          priorityLabel(review.outreachPriority),
          lead.signal,
          lead.signalDate,
          `${lead.signal}: ${lead.researchSummary}`,
          lead.industry,
          whyItFits,
          review.unverified.join("; "),
          contact?.decisionMaker ?? "",
          contact?.role ?? "",
          contact?.publicEmail ?? "",
          emailUsabilityLabel(contact),
          contact?.emailSource ?? "",
          lead.signalUrl,
          review.caseStudy,
          disqualifiers,
          disqualifiers === "" ? "Research" : "Reject",
          disqualifiers === ""
            ? "Research decision maker, public email and specific delivery need."
            : "Do not pursue unless the disqualifier is resolved.",
        ],
      },
    ];
  });
}

const same = (left: unknown, right: unknown): boolean =>
  text(left).trim() === text(right).trim();

export class LeadReviewSheet {
  constructor(private readonly transport: GoogleSheetsTransport) {}

  async sync(
    outputs: readonly DryRunOutputRow[],
  ): Promise<LeadReviewSyncResult> {
    const materialized = materializeLeadReviews(outputs);
    const existing = await this.transport.getValues(
      `${SHEET}!A${String(FIRST_DATA_ROW)}:X${String(LAST_DATA_ROW)}`,
    );
    const indexes = new Map<string, number>();
    existing.forEach((row, index) => {
      const leadId = text(row[0]).trim();
      if (leadId !== "") indexes.set(leadId, index);
    });
    let nextIndex = existing.findIndex((row) => text(row[0]).trim() === "");
    if (nextIndex < 0) nextIndex = existing.length;

    const updates: SheetValueUpdate[] = [];
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const lead of materialized) {
      const existingIndex = indexes.get(lead.leadId);
      if (existingIndex === undefined) {
        const rowNumber = FIRST_DATA_ROW + nextIndex;
        if (rowNumber > LAST_DATA_ROW)
          throw new Error("Lead Review has no writable rows remaining");
        updates.push({
          range: `${SHEET}!A${String(rowNumber)}:X${String(rowNumber)}`,
          values: [lead.values],
        });
        indexes.set(lead.leadId, nextIndex);
        nextIndex += 1;
        created += 1;
        continue;
      }

      const row = existing[existingIndex] ?? [];
      const rowNumber = FIRST_DATA_ROW + existingIndex;
      const ranges: { start: number; end: number }[] = [
        { start: 0, end: 2 },
        { start: 4, end: 13 },
        { start: 19, end: 21 },
      ];
      let changed = false;
      for (const range of ranges) {
        const desired = lead.values.slice(range.start, range.end + 1);
        const current = row.slice(range.start, range.end + 1);
        if (!desired.every((value, index) => same(value, current[index]))) {
          updates.push({
            range: `${SHEET}!${String.fromCharCode(65 + range.start)}${String(rowNumber)}:${String.fromCharCode(65 + range.end)}${String(rowNumber)}`,
            values: [desired],
          });
          changed = true;
        }
      }

      if (lead.contact !== undefined) {
        const contactIndexes = [14, 15, 16, 17, 18] as const;
        for (const column of contactIndexes) {
          const desired = lead.values[column];
          const current = row[column];
          const isResearchPlaceholder =
            column === 17 && text(current).toLowerCase() === "not researched";
          if (
            (text(current).trim() === "" || isResearchPlaceholder) &&
            text(desired).trim() !== "" &&
            !same(current, desired)
          ) {
            updates.push({
              range: `${SHEET}!${String.fromCharCode(65 + column)}${String(rowNumber)}`,
              values: [[desired]],
            });
            changed = true;
          }
        }
      }
      if (changed) updated += 1;
      else unchanged += 1;
    }

    if (updates.length > 0) await this.transport.batchUpdateValues(updates);
    return { created, updated, unchanged };
  }
}
