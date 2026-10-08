import { z } from "zod";

const emailSchema = z.string().email();
const COMPANY_SUFFIXES = new Set([
  "co",
  "company",
  "corp",
  "corporation",
  "inc",
  "incorporated",
  "limited",
  "llc",
  "ltd",
  "private",
  "pvt",
]);

export const normalizeEmail = (
  value: string | null | undefined,
): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return emailSchema.safeParse(normalized).success ? normalized : null;
};

export const normalizeDomain = (
  value: string | null | undefined,
): string | null => {
  if (value === null || value === undefined || value.trim() === "") {
    return null;
  }

  const candidate = value.includes("://") ? value : `https://${value}`;
  try {
    const parsed = new URL(candidate);
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (!hostname.includes(".")) {
      return null;
    }
    return hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

export const normalizeCompanyName = (value: string): string => {
  const tokens = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/);

  while (tokens.length > 1 && COMPANY_SUFFIXES.has(tokens.at(-1) ?? "")) {
    tokens.pop();
  }

  return tokens.join(" ");
};

export interface DedupCandidate {
  company: string;
  email?: string | null;
  website?: string | null;
}

export type DuplicateReason = "company" | "email" | "domain";

export interface DuplicateMatch {
  existingIndex: number;
  reasons: readonly DuplicateReason[];
}

export const findDuplicate = (
  candidate: DedupCandidate,
  existing: readonly DedupCandidate[],
): DuplicateMatch | null => {
  const company = normalizeCompanyName(candidate.company);
  const email = normalizeEmail(candidate.email);
  const domain = normalizeDomain(candidate.website);

  for (const [existingIndex, lead] of existing.entries()) {
    const reasons: DuplicateReason[] = [];
    if (company !== "" && company === normalizeCompanyName(lead.company)) {
      reasons.push("company");
    }
    if (email !== null && email === normalizeEmail(lead.email)) {
      reasons.push("email");
    }
    if (domain !== null && domain === normalizeDomain(lead.website)) {
      reasons.push("domain");
    }

    if (reasons.length > 0) {
      return { existingIndex, reasons };
    }
  }

  return null;
};
