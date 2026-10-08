import type {
  A3OutreachWriterOutput,
  A4FollowUpOutput,
} from "../llm/schemas/agents.js";

export type DraftViolationCode =
  | "email_word_limit"
  | "linkedin_word_limit"
  | "banned_phrase"
  | "follow_up_phrase"
  | "em_dash"
  | "exclamation_mark"
  | "price_figure"
  | "mentor_student_honesty"
  | "missing_opt_out";

export interface DraftViolation {
  code: DraftViolationCode;
  field: "email_body" | "linkedin_message" | "body";
  detail: string;
}

export interface DraftValidationResult {
  valid: boolean;
  violations: readonly DraftViolation[];
}

const BANNED_PHRASES = [
  "interns",
  "cheap",
  "low-cost",
  "learning program",
  "i hope this finds you well",
] as const;
const FOLLOW_UP_PHRASES = [
  "just following up",
  "bumping this",
  "circling back",
] as const;

const wordCount = (text: string): number =>
  text.trim() === "" ? 0 : text.trim().split(/\s+/).length;

const containsPhrase = (text: string, phrase: string): boolean =>
  text.toLowerCase().includes(phrase);

const containsPriceFigure = (text: string): boolean =>
  /(?:₹|\$|\bINR\b|\bRs\.?\s*\d|\b\d+(?:\.\d+)?\s*(?:lakh|lakhs|crore|crores)\b)/iu.test(
    text,
  );

const statesDeliveryModel = (text: string): boolean =>
  /\bmentors?\b[^.!?]{0,80}\blead\w*\b/iu.test(text) &&
  /\bstudents?\b[^.!?]{0,80}\bbuild\w*\b/iu.test(text);

const validateSharedText = (
  text: string,
  field: DraftViolation["field"],
): DraftViolation[] => {
  const violations: DraftViolation[] = [];
  for (const phrase of BANNED_PHRASES) {
    if (containsPhrase(text, phrase)) {
      violations.push({
        code: "banned_phrase",
        field,
        detail: `contains ${phrase}`,
      });
    }
  }
  if (text.includes("—")) {
    violations.push({ code: "em_dash", field, detail: "contains an em dash" });
  }
  if (text.includes("!")) {
    violations.push({
      code: "exclamation_mark",
      field,
      detail: "contains an exclamation mark",
    });
  }
  if (containsPriceFigure(text)) {
    violations.push({
      code: "price_figure",
      field,
      detail: "contains a price figure",
    });
  }
  return violations;
};

export const validateFirstMessageDraft = (
  output: A3OutreachWriterOutput,
): DraftValidationResult => {
  const violations = [
    ...validateSharedText(output.email_body, "email_body"),
    ...validateSharedText(output.linkedin_message, "linkedin_message"),
  ];

  if (wordCount(output.email_body) >= 90) {
    violations.push({
      code: "email_word_limit",
      field: "email_body",
      detail: "must contain fewer than 90 words",
    });
  }
  if (wordCount(output.linkedin_message) >= 60) {
    violations.push({
      code: "linkedin_word_limit",
      field: "linkedin_message",
      detail: "must contain fewer than 60 words",
    });
  }
  for (const [field, text] of [
    ["email_body", output.email_body],
    ["linkedin_message", output.linkedin_message],
  ] as const) {
    if (!statesDeliveryModel(text)) {
      violations.push({
        code: "mentor_student_honesty",
        field,
        detail: "must say that mentors lead and students build",
      });
    }
  }
  if (
    !/(?:reply\s+["']?no thanks|won['’]?t follow up)/iu.test(output.email_body)
  ) {
    violations.push({
      code: "missing_opt_out",
      field: "email_body",
      detail: "must include the approved simple opt-out",
    });
  }

  return { valid: violations.length === 0, violations };
};

export const validateFollowUpDraft = (
  output: A4FollowUpOutput,
): DraftValidationResult => {
  const violations = validateSharedText(output.body, "body");
  for (const phrase of FOLLOW_UP_PHRASES) {
    if (containsPhrase(output.body, phrase)) {
      violations.push({
        code: "follow_up_phrase",
        field: "body",
        detail: `contains ${phrase}`,
      });
    }
  }
  return { valid: violations.length === 0, violations };
};
