import { z } from "zod";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const isoDateSchema = z
  .string()
  .regex(ISO_DATE_PATTERN, "must use YYYY-MM-DD")
  .refine((value) => {
    const instant = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(instant.valueOf()) &&
      instant.toISOString().slice(0, 10) === value
    );
  }, "must be a real calendar date");

export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const nonEmptyTextSchema = z.string().trim().min(1);
export const nullableTextSchema = nonEmptyTextSchema.nullable();
export const urlSchema = z.string().url();

export const domainOrUrlSchema = nonEmptyTextSchema.refine((value) => {
  const candidate = value.includes("://") ? value : `https://${value}`;
  try {
    const parsed = new URL(candidate);
    return (
      parsed.hostname.includes(".") && !parsed.username && !parsed.password
    );
  } catch {
    return false;
  }
}, "must be a valid domain or URL");

export const leadIdSchema = z.string().regex(/^L-\d{8}-\d{3}$/, {
  message: "must use L-YYYYMMDD-NNN",
});

export const runIdSchema = z.string().uuid();

export const evidenceSchema = z
  .object({
    claim: nonEmptyTextSchema,
    sourceUrl: urlSchema,
    sourceTitle: nullableTextSchema.default(null),
    retrievedAt: isoDateTimeSchema,
    excerpt: nullableTextSchema.default(null),
  })
  .strict();

export type Evidence = z.infer<typeof evidenceSchema>;
