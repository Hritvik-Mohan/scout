import { z } from "zod";

import { isoDateSchema } from "./models/common.js";

const requiredString = z.string().trim().min(1, "is required");

const integerFromEnvironment = (minimum: number, maximum?: number) =>
  z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : value),
    z.coerce
      .number()
      .int()
      .min(minimum)
      .pipe(maximum === undefined ? z.number() : z.number().max(maximum)),
  );

const booleanFromEnvironment = z.preprocess((value) => {
  if (value === undefined || value === "") {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }

  return value;
}, z.boolean());

const localTimeSchema = z
  .string()
  .regex(/^\d{2}:\d{2}$/, "must use HH:mm in 24-hour time")
  .refine((value) => {
    const [hours, minutes] = value.split(":").map(Number);
    return (
      hours !== undefined && minutes !== undefined && hours < 24 && minutes < 60
    );
  }, "must be a valid 24-hour time");

const timezoneSchema = z
  .string()
  .trim()
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "must be a valid IANA timezone");

const workingDaysSchema = z
  .string()
  .transform((value, context) => {
    const tokens = value.split(",").map((token) => token.trim());
    const days = tokens.map(Number);

    if (
      tokens.some((token) => token === "") ||
      days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "must be comma-separated ISO weekdays from 1 (Monday) to 7 (Sunday)",
      });
      return z.NEVER;
    }

    if (new Set(days).size !== days.length) {
      context.addIssue({
        code: "custom",
        message: "must not contain duplicate weekdays",
      });
      return z.NEVER;
    }

    return days.sort((left, right) => left - right);
  })
  .pipe(z.array(z.number().int().min(1).max(7)).min(1));

const holidayDatesSchema = z.string().transform((value, context) => {
  if (value.trim() === "") {
    return [];
  }

  const dates = value.split(",").map((date) => date.trim());
  for (const date of dates) {
    const result = isoDateSchema.safeParse(date);
    if (!result.success) {
      context.addIssue({
        code: "custom",
        message: `contains invalid date ${date}; use comma-separated YYYY-MM-DD values`,
      });
      return z.NEVER;
    }
  }

  return [...new Set(dates)].sort();
});

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DRY_RUN: booleanFromEnvironment.default(true),
    TIMEZONE: timezoneSchema.default("Asia/Kolkata"),
    WORKING_DAYS: workingDaysSchema.default("1,2,3,4,5"),
    WORKING_HOURS_START: localTimeSchema.default("09:00"),
    WORKING_HOURS_END: localTimeSchema.default("18:00"),
    HOLIDAY_DATES: holidayDatesSchema.default(""),
    CONCURRENCY: integerFromEnvironment(1, 1).default(1),

    TRACKER_SHEET_ID: requiredString,
    SALES_BRAIN_DOC_ID: requiredString,
    PROMPT_LIBRARY_DOC_ID: requiredString,
    PROPOSAL_TEMPLATE_DOC_ID: requiredString,
    BRIEFS_FOLDER_ID: requiredString,
    PROPOSALS_FOLDER_ID: requiredString,
    TRANSCRIPTS_FOLDER_ID: requiredString,
    OWNER_EMAIL: z.string().trim().email(),

    MAX_NEW_LEADS_PER_DAY: integerFromEnvironment(1).default(20),
    RESEARCH_BATCH_SIZE: integerFromEnvironment(1).default(10),
    MIN_FIT_TO_KEEP: integerFromEnvironment(1, 5).default(2),
    MIN_FIT_TO_CONTACT: integerFromEnvironment(1, 5).default(3),
    MAX_DRAFTS_PER_DAY: integerFromEnvironment(1).default(15),
    MAX_FOLLOWUPS_PER_DAY: integerFromEnvironment(1).default(10),
    MAX_TOUCHES: integerFromEnvironment(1).default(4),
    FOLLOWUP_INTERVAL_DAYS: integerFromEnvironment(1).default(4),
    REQUIRE_APPROVAL_CHECKBOX: booleanFromEnvironment.default(false),

    LLM_PROVIDER: requiredString,
    LLM_MODEL_FAST: requiredString,
    LLM_MODEL_WRITER: requiredString,
    SEARCH_PROVIDER: requiredString,
  })
  .superRefine((value, context) => {
    if (
      toMinutes(value.WORKING_HOURS_START) >= toMinutes(value.WORKING_HOURS_END)
    ) {
      context.addIssue({
        code: "custom",
        message: "must be later than WORKING_HOURS_START",
        path: ["WORKING_HOURS_END"],
      });
    }

    if (value.MIN_FIT_TO_CONTACT < value.MIN_FIT_TO_KEEP) {
      context.addIssue({
        code: "custom",
        message: "must be greater than or equal to MIN_FIT_TO_KEEP",
        path: ["MIN_FIT_TO_CONTACT"],
      });
    }
  });

export type AppConfig = z.infer<typeof environmentSchema>;

export interface ConfigIssue {
  field: string;
  message: string;
}

export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(
      `Invalid configuration: ${issues
        .map((issue) => `${issue.field} ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "ConfigError";
    this.issues = issues;
  }
}

export const loadConfig = (environment: NodeJS.ProcessEnv): AppConfig => {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => ({
        field: issue.path.join(".") || "configuration",
        message: issue.message,
      })),
    );
  }

  return result.data;
};

const sensitiveName =
  /(?:api[_-]?key|credential|password|private[_-]?key|secret|token)/i;

export const redactEnvironment = (
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> =>
  Object.fromEntries(
    Object.entries(environment).map(([key, value]) => [
      key,
      sensitiveName.test(key) && value !== undefined ? "[REDACTED]" : value,
    ]),
  );

export const toMinutes = (localTime: string): number => {
  const [hours = 0, minutes = 0] = localTime.split(":").map(Number);
  return hours * 60 + minutes;
};
