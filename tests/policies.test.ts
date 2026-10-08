import { describe, expect, it } from "vitest";

import { addBusinessDays, isBusinessDay } from "../src/core/business-days.js";
import { checkDailyCap } from "../src/core/caps.js";
import {
  findDuplicate,
  normalizeCompanyName,
  normalizeDomain,
  normalizeEmail,
} from "../src/core/dedup.js";
import {
  InvalidDoNotContactEntryError,
  matchDoNotContact,
} from "../src/core/dnc.js";
import {
  validateFirstMessageDraft,
  validateFollowUpDraft,
} from "../src/core/draft-checks.js";
import { validateEvidenceCoverage } from "../src/core/evidence.js";
import {
  assertProspectOperationAllowed,
  ProhibitedProspectOperationError,
} from "../src/core/outbound-policy.js";
import {
  allowedNextStages,
  assertValidTransition,
  canTransition,
  InvalidStageTransitionError,
} from "../src/core/stages.js";

describe("stage transition policy", () => {
  it("allows documented transitions including direct calendar booking", () => {
    expect(canTransition("New", "Researched")).toBe(true);
    expect(canTransition("Contacted", "Call booked")).toBe(true);
    expect(allowedNextStages("Won")).toEqual([]);
  });

  it("fails closed for invalid transitions", () => {
    expect(() =>
      assertValidTransition({
        leadId: "L-20261007-001",
        from: "New",
        to: "Won",
        actor: "A2",
        reason: "invalid_test",
        occurredAt: "2026-10-07T10:00:00.000Z",
      }),
    ).toThrow(InvalidStageTransitionError);
  });
});

describe("deduplication policy", () => {
  it("normalizes emails, domains, and common company suffixes", () => {
    expect(normalizeEmail(" Founder@Example.COM ")).toBe("founder@example.com");
    expect(normalizeDomain("https://www.Example.com/about")).toBe(
      "example.com",
    );
    expect(normalizeCompanyName("Example Technologies Pvt. Ltd.")).toBe(
      "example technologies",
    );
  });

  it("finds duplicates by company, email, or exact normalized domain", () => {
    expect(
      findDuplicate(
        { company: "Example Technologies", email: "new@example.com" },
        [
          {
            company: "Example Technologies Pvt Ltd",
            email: "founder@example.com",
            website: "https://example.com",
          },
        ],
      ),
    ).toEqual({ existingIndex: 0, reasons: ["company"] });
  });

  it("does not guess invalid identifiers", () => {
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeDomain("localhost")).toBeNull();
  });
});

describe("Do Not Contact policy", () => {
  const entries = [
    { kind: "email" as const, normalizedValue: "blocked@example.com" },
    { kind: "domain" as const, normalizedValue: "no-contact.test" },
  ];

  it("blocks exact emails and domains including subdomains", () => {
    expect(
      matchDoNotContact({ email: "blocked@example.com" }, entries).blocked,
    ).toBe(true);
    expect(
      matchDoNotContact({ website: "https://careers.no-contact.test" }, entries)
        .blocked,
    ).toBe(true);
  });

  it("permits contacts with no match", () => {
    expect(matchDoNotContact({ email: "ok@example.com" }, entries)).toEqual({
      blocked: false,
      matchedEntry: null,
    });
  });

  it("fails closed when a Do Not Contact entry is malformed", () => {
    expect(() =>
      matchDoNotContact({ email: "ok@example.com" }, [
        { kind: "email", normalizedValue: "not-an-email" },
      ]),
    ).toThrow(InvalidDoNotContactEntryError);
  });
});

describe("daily caps", () => {
  it("allows work through the exact limit and blocks overflow", () => {
    expect(checkDailyCap(14, 15, 1)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(checkDailyCap(15, 15, 1)).toMatchObject({
      allowed: false,
      remaining: 0,
    });
    expect(checkDailyCap(14, 15, 2)).toMatchObject({
      allowed: false,
      remaining: 1,
    });
  });

  it("rejects invalid counters", () => {
    expect(() => checkDailyCap(-1, 15)).toThrow(RangeError);
    expect(() => checkDailyCap(1.5, 15)).toThrow(TypeError);
  });
});

describe("business-day calculations", () => {
  const calendar = {
    workingDays: [1, 2, 3, 4, 5],
    holidays: ["2026-10-20"],
  };

  it("skips weekends and configured holidays", () => {
    expect(addBusinessDays("2026-10-16", 1, calendar)).toBe("2026-10-19");
    expect(addBusinessDays("2026-10-19", 1, calendar)).toBe("2026-10-21");
    expect(isBusinessDay("2026-10-20", calendar)).toBe(false);
  });

  it("keeps the starting date when zero days are requested", () => {
    expect(addBusinessDays("2026-10-18", 0, calendar)).toBe("2026-10-18");
  });

  it("rejects calendars without valid ISO weekdays", () => {
    expect(() =>
      addBusinessDays("2026-10-18", 1, { workingDays: [0], holidays: [] }),
    ).toThrow(RangeError);
  });
});

describe("evidence policy", () => {
  it("requires an evidence record for every claim and a listed source URL", () => {
    const result = validateEvidenceCoverage(
      ["Recent funding", "Needs mobile engineering"],
      [
        {
          claim: "Recent funding",
          sourceUrl: "https://example.com/funding",
          sourceTitle: null,
          retrievedAt: "2026-10-07T10:00:00.000Z",
          excerpt: null,
        },
      ],
      ["https://example.com/funding"],
    );

    expect(result.valid).toBe(false);
    expect(result.missingClaims).toEqual(["Needs mobile engineering"]);
  });
});

describe("draft safety checks", () => {
  const validFirstMessage = {
    email_subjects: ["Product capacity", "Engineering support"] as [
      string,
      string,
    ],
    email_body:
      "Mentors lead the engagement while students build the scoped product. Reply 'no thanks' and I won't follow up.",
    linkedin_message: "Mentors lead while students build the scoped product.",
    facts_used: [{ claim: "Delivery model", source: "sales_brain" as const }],
  };

  it("accepts an honest, short, opt-out-enabled first message", () => {
    expect(validateFirstMessageDraft(validFirstMessage)).toEqual({
      valid: true,
      violations: [],
    });
  });

  it("detects banned wording, punctuation, prices, and missing model disclosure", () => {
    const result = validateFirstMessageDraft({
      ...validFirstMessage,
      email_body: "Our interns are cheap — only INR 50000!",
    });
    expect(result.valid).toBe(false);
    expect(result.violations.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "banned_phrase",
        "em_dash",
        "exclamation_mark",
        "price_figure",
        "mentor_student_honesty",
        "missing_opt_out",
      ]),
    );
  });

  it("enforces under-90 and under-60 word limits", () => {
    const result = validateFirstMessageDraft({
      ...validFirstMessage,
      email_body: Array(90).fill("word").join(" "),
      linkedin_message: Array(60).fill("word").join(" "),
    });
    expect(result.violations.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["email_word_limit", "linkedin_word_limit"]),
    );
  });

  it("rejects banned follow-up phrases", () => {
    expect(
      validateFollowUpDraft({
        touch_number: 2,
        body: "Just following up with another angle.",
        new_angle: "New case study",
        facts_used: [],
      }).violations.map(({ code }) => code),
    ).toContain("follow_up_phrase");
  });
});

describe("outbound operation policy", () => {
  it("allows reads and draft creation", () => {
    expect(() =>
      assertProspectOperationAllowed("create_gmail_draft"),
    ).not.toThrow();
  });

  it("denies sending and LinkedIn automation by default", () => {
    expect(() => assertProspectOperationAllowed("send_email")).toThrow(
      ProhibitedProspectOperationError,
    );
    expect(() =>
      assertProspectOperationAllowed("send_linkedin_message"),
    ).toThrow(ProhibitedProspectOperationError);
  });
});
