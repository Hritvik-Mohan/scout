import { normalizeDomain, normalizeEmail } from "./dedup.js";

export interface DoNotContactEntry {
  kind: "email" | "domain";
  normalizedValue: string;
}

export interface ContactIdentity {
  email?: string | null;
  website?: string | null;
}

export interface DoNotContactMatch {
  blocked: boolean;
  matchedEntry: DoNotContactEntry | null;
}

export class InvalidDoNotContactEntryError extends Error {
  readonly entry: DoNotContactEntry;

  constructor(entry: DoNotContactEntry) {
    super(`Invalid Do Not Contact ${entry.kind} entry`);
    this.name = "InvalidDoNotContactEntryError";
    this.entry = entry;
  }
}

const emailDomain = (email: string | null): string | null => {
  if (email === null) {
    return null;
  }
  return email.split("@")[1] ?? null;
};

const domainMatches = (candidate: string, blocked: string): boolean =>
  candidate === blocked || candidate.endsWith(`.${blocked}`);

export const matchDoNotContact = (
  contact: ContactIdentity,
  entries: readonly DoNotContactEntry[],
): DoNotContactMatch => {
  const email = normalizeEmail(contact.email);
  const domains = [
    normalizeDomain(contact.website),
    normalizeDomain(emailDomain(email)),
  ].filter((domain): domain is string => domain !== null);

  for (const entry of entries) {
    if (entry.kind === "email") {
      const blockedEmail = normalizeEmail(entry.normalizedValue);
      if (blockedEmail === null) {
        throw new InvalidDoNotContactEntryError(entry);
      }
      if (email !== null && blockedEmail === email) {
        return { blocked: true, matchedEntry: entry };
      }
    } else {
      const blockedDomain = normalizeDomain(entry.normalizedValue);
      if (blockedDomain === null) {
        throw new InvalidDoNotContactEntryError(entry);
      }
      if (
        domains.some((candidate) => domainMatches(candidate, blockedDomain))
      ) {
        return { blocked: true, matchedEntry: entry };
      }
    }
  }

  return { blocked: false, matchedEntry: null };
};
