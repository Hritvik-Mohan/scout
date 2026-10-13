import { z } from "zod";

import { addBusinessDays } from "../core/business-days.js";
import { checkDailyCap } from "../core/caps.js";
import { normalizeCompanyName, normalizeEmail } from "../core/dedup.js";
import { matchDoNotContact, type DoNotContactEntry } from "../core/dnc.js";
import { parseCsv } from "./lets-code-workbook.js";
import { parseSheetDate, type PipelineEntry } from "./review.js";

export const JOB_OUTREACH_SHEET = "Outreach";

/**
 * Scout writes a row on import and stamps Draft Created once a Gmail draft
 * exists. Status, Contacted On and Notes belong to the human; nothing here is
 * ever sent by Scout.
 */
export const JOB_OUTREACH_HEADERS = [
  "Name",
  "Title",
  "Company",
  "Email",
  "Email Source URL",
  "Opportunity ID",
  "Role",
  "Status",
  "Contacted On",
  "Notes",
  "Date Added",
  "Draft Created",
  "Greeting",
] as const;

export const OUTREACH_STATUSES = [
  "Queued",
  "Sent",
  "Followed up",
  "Replied",
  "Bounced",
  "Do not contact",
] as const;

export const DEFAULT_OUTREACH_DAILY_CAP = 20;
export const OUTREACH_FOLLOW_UP_BUSINESS_DAYS = 5;

const CLOSED_STAGES = new Set(["Withdrawn", "Rejected", "Closed"]);

const sourceUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => /^https?:\/\//iu.test(value), "must be an http(s) URL");

/**
 * One contact the user found by hand. The source URL is where the address is
 * publicly published; a contact without one is never imported.
 */
export const outreachContactSchema = z
  .object({
    name: z.string().trim().min(1),
    title: z.string().trim().default(""),
    company: z.string().trim().min(1),
    email: z.string().trim().toLowerCase().email(),
    sourceUrl: sourceUrlSchema,
    opportunityId: z.string().trim().default(""),
    notes: z.string().trim().default(""),
    // How a draft addresses the contact, such as a first name.
    greeting: z.string().trim().default(""),
  })
  .strict();

export type OutreachContact = z.infer<typeof outreachContactSchema>;

export interface RejectedContact {
  line: number;
  reason: string;
}

const CSV_COLUMNS: Readonly<Record<string, keyof OutreachContact>> = {
  name: "name",
  title: "title",
  company: "company",
  email: "email",
  sourceurl: "sourceUrl",
  emailsourceurl: "sourceUrl",
  opportunityid: "opportunityId",
  notes: "notes",
  greeting: "greeting",
};

const REQUIRED_CSV_FIELDS = ["name", "company", "email", "sourceUrl"] as const;

/** Parses a contacts CSV with a header row; column order does not matter. */
export function parseOutreachCsv(csv: string): {
  contacts: OutreachContact[];
  rejected: RejectedContact[];
} {
  const [header, ...lines] = parseCsv(csv.replace(/^\uFEFF/u, ""));
  const fields = (header ?? []).map(
    (cell) => CSV_COLUMNS[cell.toLowerCase().replaceAll(/[^a-z]/gu, "")],
  );
  const missing = REQUIRED_CSV_FIELDS.filter(
    (field) => !fields.includes(field),
  );
  if (missing.length > 0) {
    throw new Error(
      `Contacts CSV is missing required columns: ${missing.join(", ")}`,
    );
  }
  const contacts: OutreachContact[] = [];
  const rejected: RejectedContact[] = [];
  for (const [index, cells] of lines.entries()) {
    if (cells.every((cell) => cell.trim() === "")) continue;
    const record: Record<string, string> = {};
    for (const [column, field] of fields.entries()) {
      if (field !== undefined) record[field] = cells[column] ?? "";
    }
    const parsed = outreachContactSchema.safeParse(record);
    if (parsed.success) {
      contacts.push(parsed.data);
    } else {
      rejected.push({
        line: index + 2,
        reason: parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
      });
    }
  }
  return { contacts, rejected };
}

export interface OutreachRow {
  rowNumber: number;
  name: string;
  title: string;
  company: string;
  email: string;
  sourceUrl: string;
  opportunityId: string;
  status: string;
  contactedOn: unknown;
  draftCreated: string;
  greeting: string;
}

const text = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

/** Row positions follow JOB_OUTREACH_HEADERS (A2:M). */
export const outreachRows = (
  rows: readonly (readonly unknown[])[],
): OutreachRow[] =>
  rows.flatMap((row, index) => {
    const email = text(row[3]).trim();
    const name = text(row[0]).trim();
    if (email === "" && name === "") return [];
    return [
      {
        rowNumber: index + 2,
        name,
        title: text(row[1]).trim(),
        company: text(row[2]).trim(),
        email,
        sourceUrl: text(row[4]).trim(),
        opportunityId: text(row[5]).trim(),
        status: text(row[7]).trim(),
        contactedOn: row[8],
        draftCreated: text(row[11]).trim(),
        greeting: text(row[12]).trim(),
      },
    ];
  });

const isQueued = (row: OutreachRow): boolean =>
  row.status === "" || row.status === "Queued";

const doNotContactEntries = (
  rows: readonly OutreachRow[],
): DoNotContactEntry[] =>
  rows.flatMap((row) => {
    const email = normalizeEmail(row.email);
    return row.status === "Do not contact" && email !== null
      ? [{ kind: "email" as const, normalizedValue: email }]
      : [];
  });

/** A role passes review when it has a non-skip verdict and is still open. */
export const passedReview = (entry: PipelineEntry): boolean =>
  entry.fit !== null &&
  entry.verdict !== "" &&
  entry.verdict !== "skip" &&
  !entry.flags.includes("Closed -") &&
  !CLOSED_STAGES.has(entry.stage);

/**
 * Ties a contact to a role that passed review: the pinned opportunity when it
 * qualifies, otherwise the best-fit qualifying role at the same company.
 */
export function resolveOutreachRole(
  contact: { company: string; opportunityId: string },
  entries: readonly PipelineEntry[],
): PipelineEntry | null {
  const company = normalizeCompanyName(contact.company);
  const qualifying = entries.filter(passedReview);
  return (
    qualifying.find((entry) => entry.id === contact.opportunityId) ??
    qualifying
      .filter((entry) => normalizeCompanyName(entry.company) === company)
      .sort((left, right) => (right.fit ?? 0) - (left.fit ?? 0))[0] ??
    null
  );
}

export interface OutreachImport {
  rows: (readonly string[])[];
  duplicates: readonly string[];
  doNotContact: readonly string[];
  unlinked: readonly string[];
}

/**
 * Turns validated contacts into new Outreach rows. Addresses already in the
 * tab, repeated in the file, or marked "Do not contact" are left out.
 */
export function planOutreachImport(
  contacts: readonly OutreachContact[],
  existing: readonly OutreachRow[],
  entries: readonly PipelineEntry[],
  addedOn: string,
): OutreachImport {
  const blocked = doNotContactEntries(existing);
  const seen = new Set(existing.map((row) => normalizeEmail(row.email)));
  const rows: (readonly string[])[] = [];
  const duplicates: string[] = [];
  const doNotContact: string[] = [];
  const unlinked: string[] = [];
  for (const contact of contacts) {
    if (matchDoNotContact({ email: contact.email }, blocked).blocked) {
      doNotContact.push(contact.email);
      continue;
    }
    if (seen.has(contact.email)) {
      duplicates.push(contact.email);
      continue;
    }
    seen.add(contact.email);
    const role = resolveOutreachRole(contact, entries);
    if (role === null) unlinked.push(contact.email);
    rows.push([
      contact.name,
      contact.title,
      contact.company,
      contact.email,
      contact.sourceUrl,
      role?.id ?? contact.opportunityId,
      role?.role ?? "",
      "Queued",
      "",
      contact.notes,
      addedOn,
      "",
      contact.greeting,
    ]);
  }
  return { rows, duplicates, doNotContact, unlinked };
}

export interface PlannedContact {
  row: OutreachRow;
  role: PipelineEntry;
}

export interface OutreachPlan {
  cap: number;
  sentToday: number;
  batch: readonly PlannedContact[];
  /** Eligible contacts left for another day by the cap. */
  deferred: number;
  held: readonly { row: OutreachRow; reason: string }[];
}

const sheetDay = (value: unknown): string | null => {
  const parsed = parseSheetDate(value);
  return Number.isNaN(parsed)
    ? null
    : new Date(parsed).toISOString().slice(0, 10);
};

/**
 * Picks today's batch from queued contacts. Only contacts tied to a role that
 * passed review are eligible, and the batch never exceeds the daily cap less
 * what was already sent today.
 */
export function buildOutreachPlan(
  sheetRows: readonly (readonly unknown[])[],
  entries: readonly PipelineEntry[],
  options: { today: string; cap?: number },
): OutreachPlan {
  const cap = options.cap ?? DEFAULT_OUTREACH_DAILY_CAP;
  const rows = outreachRows(sheetRows);
  const blocked = doNotContactEntries(rows);
  const sentToday = rows.filter(
    (row) => sheetDay(row.contactedOn) === options.today,
  ).length;
  const handled = new Map<string, number>();
  for (const row of rows) {
    const email = normalizeEmail(row.email);
    if (email !== null && !isQueued(row) && !handled.has(email)) {
      handled.set(email, row.rowNumber);
    }
  }
  const eligible: PlannedContact[] = [];
  const held: { row: OutreachRow; reason: string }[] = [];
  for (const row of rows.filter(isQueued)) {
    const email = normalizeEmail(row.email);
    const role = resolveOutreachRole(row, entries);
    const handledAt = email === null ? undefined : handled.get(email);
    const reason =
      email === null
        ? "Email is missing or invalid"
        : matchDoNotContact({ email }, blocked).blocked
          ? "Marked do not contact"
          : handledAt !== undefined
            ? `Already handled on row ${String(handledAt)}`
            : !/^https?:\/\//iu.test(row.sourceUrl)
              ? "No public source URL for the email"
              : role === null
                ? "No role at this company has passed review"
                : null;
    if (reason !== null || role === null || email === null) {
      held.push({ row, reason: reason ?? "" });
      continue;
    }
    handled.set(email, row.rowNumber);
    eligible.push({ row, role });
  }
  eligible.sort(
    (left, right) =>
      (right.role.fit ?? 0) - (left.role.fit ?? 0) ||
      left.row.rowNumber - right.row.rowNumber,
  );
  const { remaining } = checkDailyCap(Math.min(sentToday, cap), cap);
  const batch = eligible.slice(0, remaining);
  return {
    cap,
    sentToday,
    batch,
    deferred: eligible.length - batch.length,
    held,
  };
}

/** Contacted On holds a calendar date, so "today" is the local date. */
export const localDay = (now: Date): string =>
  [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");

/** Reads an optional `--cap=<n>` command-line argument. */
export function outreachCapArgument(argv: readonly string[]): number {
  const argument = argv
    .find((value) => value.startsWith("--cap="))
    ?.slice("--cap=".length);
  const cap =
    argument === undefined ? DEFAULT_OUTREACH_DAILY_CAP : Number(argument);
  if (!Number.isInteger(cap) || cap < 0) {
    throw new Error("--cap must be a whole number, 0 or more");
  }
  return cap;
}

export function formatOutreachPlan(plan: OutreachPlan): string {
  const lines = [
    `Outreach: ${String(plan.sentToday)} sent today, daily cap ${String(plan.cap)}, ${String(plan.batch.length)} in today's batch, ${String(plan.deferred)} left for another day.`,
    "",
    "Today's batch (ranked by the fit of the linked role; Scout sends nothing):",
    ...(plan.batch.length === 0
      ? ["- Nothing to send."]
      : plan.batch.map(
          ({ row, role }) =>
            `- Row ${String(row.rowNumber)} | ${row.name}${row.title === "" ? "" : ` (${row.title})`} | ${row.email} | ${row.company} - ${role.role} | fit ${String(role.fit)} (${role.verdict})${row.draftCreated === "" ? "" : " | draft ready"}`,
        )),
  ];
  if (plan.held.length > 0) {
    lines.push(
      "",
      "Held back:",
      ...plan.held.map(
        ({ row, reason }) =>
          `- Row ${String(row.rowNumber)} | ${row.name} | ${row.company} | ${reason}`,
      ),
    );
  }
  return lines.join("\n");
}

/**
 * One Gmail draft for a human to review and send. Scout only writes these to a
 * local file; whoever creates the draft must never send it.
 */
export interface OutreachDraft {
  rowNumber: number;
  to: string;
  name: string;
  company: string;
  opportunityId: string;
  role: string;
  subject: string;
  body: string;
}

export interface OutreachDrafts {
  drafts: readonly OutreachDraft[];
  /** Batch contacts that already have a draft. */
  alreadyDrafted: number;
  /** Batch contacts whose role has no outreach draft in Application Kit. */
  missing: readonly PlannedContact[];
}

/**
 * Turns today's batch into draft emails, using the outreach draft written for
 * each contact's role during review. `[name]` becomes the contact's Greeting,
 * or the full Name when no greeting is set.
 * `kitRows` are Application Kit rows (A2:H).
 */
export function buildOutreachDrafts(
  plan: OutreachPlan,
  kitRows: readonly (readonly unknown[])[],
): OutreachDrafts {
  const kit = new Map(
    kitRows.map((row) => [text(row[0]).trim(), text(row[7]).trim()] as const),
  );
  const drafts: OutreachDraft[] = [];
  const missing: PlannedContact[] = [];
  let alreadyDrafted = 0;
  for (const contact of plan.batch) {
    const { row, role } = contact;
    if (row.draftCreated !== "") {
      alreadyDrafted += 1;
      continue;
    }
    const template = kit.get(role.id) ?? "";
    if (template === "") {
      missing.push(contact);
      continue;
    }
    drafts.push({
      rowNumber: row.rowNumber,
      to: normalizeEmail(row.email) ?? row.email,
      name: row.name,
      company: row.company,
      opportunityId: role.id,
      role: role.role,
      subject: `${role.role} role at ${role.company}`,
      body: template.replaceAll(
        /\[name\]/giu,
        row.greeting === "" ? row.name : row.greeting,
      ),
    });
  }
  return { drafts, alreadyDrafted, missing };
}

/** What the draft creator reports back: one entry per Gmail draft it made. */
export const createdOutreachDraftsSchema = z
  .array(
    z
      .object({
        rowNumber: z.number().int().min(2),
        to: z.string().trim().toLowerCase().email(),
      })
      .strict(),
  )
  .min(1);

export type CreatedOutreachDraft = z.infer<
  typeof createdOutreachDraftsSchema
>[number];

/**
 * Lists contacts emailed a working week or more ago with no reply recorded,
 * for the daily digest. A contact leaves the list once its Status moves on
 * from "Sent", so each one is prompted for a single follow-up. Returns an
 * empty string when there is nothing to report.
 */
export function buildOutreachFollowUps(
  sheetRows: readonly (readonly unknown[])[],
  options: { today: string; afterBusinessDays?: number },
): string {
  const after = options.afterBusinessDays ?? OUTREACH_FOLLOW_UP_BUSINESS_DAYS;
  const calendar = { workingDays: [1, 2, 3, 4, 5], holidays: [] };
  const sent = outreachRows(sheetRows)
    .filter((row) => row.status === "Sent")
    .map((row) => ({ row, emailedOn: sheetDay(row.contactedOn) }));
  const due = sent
    .flatMap(({ row, emailedOn }) =>
      emailedOn !== null &&
      addBusinessDays(emailedOn, after, calendar) <= options.today
        ? [{ row, emailedOn }]
        : [],
    )
    .sort(
      (left, right) =>
        left.emailedOn.localeCompare(right.emailedOn) ||
        left.row.rowNumber - right.row.rowNumber,
    );
  const undated = sent.filter(({ emailedOn }) => emailedOn === null).length;
  const lines: string[] = [];
  if (due.length > 0) {
    lines.push(
      `Follow up with contacts (emailed ${String(after)}+ working days ago, no reply recorded):`,
      ...due.map(
        ({ row, emailedOn }) =>
          `- Outreach row ${String(row.rowNumber)} | emailed ${emailedOn} | ${row.name} | ${row.email} | ${row.company}`,
      ),
    );
  }
  if (undated > 0) {
    lines.push(
      `${String(undated)} sent contact(s) have no Contacted On date, so no follow-up can be timed.`,
    );
  }
  return lines.join("\n");
}
