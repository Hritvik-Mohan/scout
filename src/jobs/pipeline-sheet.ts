import type {
  GoogleSheetsTransport,
  SheetValueUpdate,
} from "../integrations/google-sheets.js";
import type { ScoutScore } from "../profiles/scorer.js";
import type { AssessedJob } from "./assess.js";
import { jobFlags } from "./flags.js";
import { normalizeCompanyName } from "./lets-code-workbook.js";
import type { DiscoveredJob } from "./model.js";

export interface JobPipelineWrite {
  job: DiscoveredJob;
  assessed: AssessedJob;
  score: ScoutScore;
}

export interface JobRunSummary {
  runId: string;
  started: string;
  finished: string;
  status: "success" | "partial" | "failed";
  opportunitiesFound: number;
  kept: number;
  action: number;
  error: string | null;
}

const text = (value: unknown): string => {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
};

const firstEmptyRow = (
  rows: readonly (readonly unknown[])[],
  firstRow: number,
): number => {
  const index = rows.findIndex((row) => text(row[0]).trim() === "");
  return firstRow + (index === -1 ? rows.length : index);
};

const workMode = (job: DiscoveredJob): string => {
  const evidence =
    `${job.candidateLocation} ${job.description} ${job.tags.join(" ")}`.toLowerCase();
  return job.provider === "Remotive" ||
    ["remote", "work from home", "work-from-home"].some((term) =>
      evidence.includes(term),
    )
    ? "Remote"
    : "On-site / hybrid - verify";
};

export const MISSING_FLAG = "Not found on the employer's board";
export const CLOSED_FLAG = "Closed - no longer on the employer's board";

export class JobPipelineSheetRepository {
  private pipelineRows: Promise<unknown[][]> | undefined;
  private companyContacts:
    | Promise<ReadonlyMap<string, { contact: string; referral: string }>>
    | undefined;

  constructor(private readonly transport: GoogleSheetsTransport) {}

  private loadPipelineRows(): Promise<unknown[][]> {
    this.pipelineRows ??= this.transport
      .getValues("'Job Pipeline'!A2:W1000")
      .then((rows) => rows.map((row) => [...row]));
    return this.pipelineRows;
  }

  private async contactForCompany(
    company: string,
  ): Promise<{ contact: string; referral: string }> {
    this.companyContacts ??= this.transport
      .getValues("'Companies'!B2:S2000")
      .then(
        (rows) =>
          new Map(
            rows.flatMap((row) => {
              const name = normalizeCompanyName(text(row[0]));
              if (name === "") return [];
              const contact =
                text(row[14]).trim() ||
                text(row[7]).trim() ||
                text(row[9]).trim() ||
                text(row[6]).trim();
              const referral = text(row[17]).trim() || text(row[10]).trim();
              return [[name, { contact, referral }] as const];
            }),
          ),
      )
      .catch(() => new Map());
    return (
      (await this.companyContacts).get(normalizeCompanyName(company)) ?? {
        contact: "",
        referral: "",
      }
    );
  }

  /**
   * Writes every role in one batch so large refreshes stay within the Sheets
   * per-minute quota, then verifies the automated fields with a single read.
   */
  async upsertMany(
    writes: readonly JobPipelineWrite[],
    now: Date = new Date(),
  ): Promise<{ inserted: number; updated: number }> {
    const rows = await this.loadPipelineRows();
    const updates: SheetValueUpdate[] = [];
    const expected: { rowNumber: number; write: JobPipelineWrite }[] = [];
    let inserted = 0;
    for (const write of writes) {
      const companyContact = await this.contactForCompany(write.job.company);
      const rowIndex = rows.findIndex((row) => row[0] === write.job.id);
      const rowNumber = rowIndex < 0 ? firstEmptyRow(rows, 2) : rowIndex + 2;
      const evidence = JSON.stringify({
        source: write.job.provider,
        reasons: write.score.reasons,
        criteria: write.assessed.assessment.criteria,
        signals: write.assessed.assessment.signals,
      });
      const automatedValues = [
        write.job.id,
        write.job.title,
        write.job.company,
        write.job.url,
        write.job.publishedAt.slice(0, 10),
        write.job.candidateLocation,
        workMode(write.job),
        write.job.jobType ?? "Unknown - verify",
        "Unknown - verify",
        write.assessed.experienceRequired,
        write.assessed.techStack.join(", "),
        write.job.salary ?? "Not published",
        companyContact.contact,
        companyContact.referral,
        write.score.score,
        write.score.status,
        evidence,
      ];
      updates.push({
        range: `'Job Pipeline'!A${String(rowNumber)}:Q${String(rowNumber)}`,
        values: [automatedValues],
      });
      const newHuman = [
        false,
        "",
        "Discovered",
        "Review role and verify employment terms",
        `Source: ${write.job.provider}`,
      ];
      if (rowIndex < 0) {
        inserted += 1;
        updates.push({
          range: `'Job Pipeline'!R${String(rowNumber)}:V${String(rowNumber)}`,
          values: [newHuman],
        });
        // Date Added is written once, when the role first enters the pipeline.
        updates.push({
          range: `'Job Pipeline'!AB${String(rowNumber)}:AB${String(rowNumber)}`,
          values: [[now.toISOString().slice(0, 10)]],
        });
      }
      const duplicate = rows.find(
        (row) =>
          row[0] !== write.job.id &&
          text(row[0]).trim() !== "" &&
          text(row[1]).trim().toLowerCase() ===
            write.job.title.trim().toLowerCase() &&
          text(row[2]).trim().toLowerCase() ===
            write.job.company.trim().toLowerCase(),
      );
      const flags = [
        ...jobFlags(write.job, write.assessed.experienceRequired, now),
        ...(duplicate === undefined
          ? []
          : [`Possible duplicate of ${text(duplicate[0])}`]),
      ].join("; ");
      updates.push({
        range: `'Job Pipeline'!W${String(rowNumber)}:W${String(rowNumber)}`,
        values: [[flags]],
      });
      const preservedHuman =
        rowIndex < 0 ? newHuman : (rows[rowIndex] ?? []).slice(17, 22);
      while (preservedHuman.length < 5) preservedHuman.push("");
      while (rows.length < rowNumber - 2) rows.push([]);
      rows[rowNumber - 2] = [...automatedValues, ...preservedHuman, flags];
      expected.push({ rowNumber, write });
    }
    if (updates.length === 0) return { inserted: 0, updated: 0 };
    await this.transport.batchUpdateValues(updates);
    const verification = await this.transport.getValues(
      "'Job Pipeline'!A2:P1000",
    );
    for (const { rowNumber, write } of expected) {
      const row = verification[rowNumber - 2];
      if (
        row?.[0] !== write.job.id ||
        Number(row[14]) !== write.score.score ||
        row[15] !== write.score.status
      ) {
        throw new Error(`Job Pipeline verification failed for ${write.job.id}`);
      }
    }
    return { inserted, updated: writes.length - inserted };
  }

  async upsert(write: JobPipelineWrite): Promise<"inserted" | "updated"> {
    const outcome = await this.upsertMany([write]);
    return outcome.inserted === 1 ? "inserted" : "updated";
  }

  /** Clears untracked rows for the given roles in one batch. */
  async removeManyIfUntracked(
    opportunityIds: readonly string[],
  ): Promise<number> {
    const rows = await this.loadPipelineRows();
    const updates: SheetValueUpdate[] = [];
    for (const opportunityId of opportunityIds) {
      const rowIndex = rows.findIndex((row) => row[0] === opportunityId);
      if (rowIndex < 0) continue;
      const row = rows[rowIndex];
      const applied =
        row?.[17] === true || text(row?.[17]).toLowerCase() === "true";
      const stage = text(row?.[19]);
      if (applied || (stage !== "" && stage !== "Discovered")) continue;
      const rowNumber = rowIndex + 2;
      updates.push({
        range: `'Job Pipeline'!A${String(rowNumber)}:AB${String(rowNumber)}`,
        values: [Array.from({ length: 28 }, () => "")],
      });
      rows[rowIndex] = [];
    }
    if (updates.length > 0) await this.transport.batchUpdateValues(updates);
    return updates.length;
  }

  /**
   * Handles roles that have vanished from their employer's board. The first
   * miss only flags the row, so one short feed response cannot delete a role.
   * A second miss removes an untracked row and marks a tracked one closed.
   */
  async reconcileMissing(
    completePrefixes: readonly string[],
    seenIds: ReadonlySet<string>,
    now: Date = new Date(),
  ): Promise<{
    flagged: number;
    closed: number;
    removed: readonly string[];
  }> {
    const rows = await this.loadPipelineRows();
    const today = now.toISOString().slice(0, 10);
    const updates: SheetValueUpdate[] = [];
    const removed: string[] = [];
    let flagged = 0;
    let closed = 0;
    rows.forEach((row, rowIndex) => {
      const id = text(row[0]).trim();
      if (
        id === "" ||
        seenIds.has(id) ||
        !completePrefixes.some((prefix) => id.startsWith(prefix))
      ) {
        return;
      }
      const rowNumber = rowIndex + 2;
      const flags = text(row[22]);
      if (flags.includes(CLOSED_FLAG)) return;
      const setFlags = (value: string): void => {
        updates.push({
          range: `'Job Pipeline'!W${String(rowNumber)}:W${String(rowNumber)}`,
          values: [[value]],
        });
        row[22] = value;
      };
      const kept = flags
        .split("; ")
        .filter((flag) => flag !== "" && !flag.startsWith(MISSING_FLAG));
      if (!flags.includes(MISSING_FLAG)) {
        setFlags(
          [...kept, `${MISSING_FLAG} on ${today} - may be closed`].join("; "),
        );
        flagged += 1;
        return;
      }
      const applied =
        row[17] === true || text(row[17]).toLowerCase() === "true";
      const stage = text(row[19]);
      if (applied || (stage !== "" && stage !== "Discovered")) {
        setFlags([...kept, `${CLOSED_FLAG} (confirmed ${today})`].join("; "));
        closed += 1;
        return;
      }
      updates.push({
        range: `'Job Pipeline'!A${String(rowNumber)}:AB${String(rowNumber)}`,
        values: [Array.from({ length: 28 }, () => "")],
      });
      rows[rowIndex] = [];
      removed.push(id);
    });
    if (updates.length > 0) await this.transport.batchUpdateValues(updates);
    return { flagged, closed, removed };
  }

  async removeIfUntracked(opportunityId: string): Promise<boolean> {
    return (await this.removeManyIfUntracked([opportunityId])) === 1;
  }

  async appendRun(run: JobRunSummary): Promise<void> {
    const rows = await this.transport.getValues("'Runs'!A2:H1000");
    if (rows.some((row) => row[0] === run.runId)) return;
    const rowNumber = firstEmptyRow(rows, 2);
    await this.transport.batchUpdateValues([
      {
        range: `'Runs'!A${String(rowNumber)}:H${String(rowNumber)}`,
        values: [
          [
            run.runId,
            run.started,
            run.finished,
            run.status,
            run.opportunitiesFound,
            run.kept,
            run.action,
            run.error ?? "",
          ],
        ],
      },
    ]);
  }
}
