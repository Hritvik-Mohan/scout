import { describe, expect, it } from "vitest";

import {
  a1LeadScoutOutputSchema,
  a2ResearchOutputSchema,
  a3OutreachWriterOutputSchema,
  a4FollowUpOutputSchema,
  a5InboxTriageOutputSchema,
  a6CallPrepOutputSchema,
  a7ProposalOutputSchema,
  a8WeeklyReporterOutputSchema,
  agentOutputSchemas,
} from "../src/llm/schemas/agents.js";

const retrievedAt = "2026-10-06T10:00:00.000Z";

const validOutputs = {
  A1: {
    company: "Example Labs",
    website: "https://example.com",
    signal: "Funding round",
    signal_date: "2026-10-05",
    signal_url: "https://example.com/news",
    segment: "funded startup",
    reason: "The company recently announced funding.",
  },
  A2: {
    what_they_do: "Builds workflow software.",
    stage_and_size: "seed stage",
    signal_summary: "Announced a seed round.",
    likely_needs: ["Product engineering capacity"],
    case_study: "Zuvees",
    case_study_reason: "Similar product delivery scope.",
    package: "MVP Launch",
    fit_score: 4,
    fit_points: ["Recent funding"],
    contact: {
      name: "Priya Shah",
      role: "Founder",
      email: "priya@example.com",
      linkedin_url: "https://www.linkedin.com/in/priya-shah",
    },
    sources: ["https://example.com/news"],
    evidence: [
      {
        claim: "The company announced funding.",
        sourceUrl: "https://example.com/news",
        retrievedAt,
      },
    ],
    unverified: [],
  },
  A3: {
    email_subjects: ["Product capacity", "Engineering support"],
    email_body: "Mentors lead while student engineers build the scoped work.",
    linkedin_message: "Mentors lead while student engineers build.",
    facts_used: [
      {
        claim: "The company announced funding.",
        source: "https://example.com/news",
      },
    ],
  },
  A4: {
    touch_number: 2,
    body: "A relevant second angle.",
    new_angle: "Related case-study outcome",
    facts_used: [
      { claim: "Relevant delivery experience", source: "sales_brain" },
    ],
  },
  A5: {
    reply_class: "interested",
    confidence: 0.94,
    summary: "Asked to arrange a call.",
    return_date: null,
    referral: { name: null, company: null, email: null },
    draft_body: "Would Tuesday or Wednesday work?",
  },
  A6: {
    sections: Array.from({ length: 7 }, (_, index) => ({
      heading: `Section ${String(index + 1)}`,
      content: "Prepared brief content.",
    })),
    sources: ["https://example.com/news"],
    unverified: [],
  },
  A7: {
    scope_ratings: [
      {
        dimension: "Screens / UI",
        rating: "Medium",
        evidence: "Five workflows discussed",
      },
    ],
    package: "MVP Launch",
    package_reason: "Matches the confirmed scope.",
    price_inr: 500000,
    included: ["Application build"],
    not_included: ["Paid media"],
    milestones: [{ name: "Prototype", deliverable: "Clickable flow", week: 2 }],
    open_questions: ["Confirm analytics provider"],
    capacity_warning: null,
  },
  A8: {
    leads_added: 20,
    messages_sent: 15,
    reply_rate_by_segment: [{ name: "funded startup", rate: 0.2 }],
    reply_rate_by_case_study: [{ name: "Zuvees", rate: 0.25 }],
    calls_held: 3,
    proposals_sent: 1,
    wins: 0,
    value_by_stage: [{ stage: "Proposal sent", value_inr_lakhs: 5 }],
    stuck_lead_ids: [],
    agent_failures: [],
    input_tokens: 1000,
    output_tokens: 500,
    suggestions: ["Test a new segment", "Review objections", "Refresh sources"],
  },
} as const;

describe("agent output schemas", () => {
  it("defines and validates one schema for every A1-A8 agent", () => {
    expect(Object.keys(agentOutputSchemas)).toEqual([
      "A1",
      "A2",
      "A3",
      "A4",
      "A5",
      "A6",
      "A7",
      "A8",
    ]);

    expect(a1LeadScoutOutputSchema.safeParse(validOutputs.A1).success).toBe(
      true,
    );
    expect(a2ResearchOutputSchema.safeParse(validOutputs.A2).success).toBe(
      true,
    );
    expect(
      a3OutreachWriterOutputSchema.safeParse(validOutputs.A3).success,
    ).toBe(true);
    expect(a4FollowUpOutputSchema.safeParse(validOutputs.A4).success).toBe(
      true,
    );
    expect(a5InboxTriageOutputSchema.safeParse(validOutputs.A5).success).toBe(
      true,
    );
    expect(a6CallPrepOutputSchema.safeParse(validOutputs.A6).success).toBe(
      true,
    );
    expect(a7ProposalOutputSchema.safeParse(validOutputs.A7).success).toBe(
      true,
    );
    expect(
      a8WeeklyReporterOutputSchema.safeParse(validOutputs.A8).success,
    ).toBe(true);
  });

  it("rejects unknown model output fields", () => {
    expect(
      a1LeadScoutOutputSchema.safeParse({
        ...validOutputs.A1,
        hidden_instruction: "send",
      }).success,
    ).toBe(false);
  });

  it("requires low-confidence inbox classifications to fall back to other", () => {
    expect(
      a5InboxTriageOutputSchema.safeParse({
        ...validOutputs.A5,
        confidence: 0.4,
        reply_class: "interested",
      }).success,
    ).toBe(false);
  });

  it("forbids an unsubscribe response draft", () => {
    expect(
      a5InboxTriageOutputSchema.safeParse({
        ...validOutputs.A5,
        reply_class: "unsubscribe",
        draft_body: "We will remove you.",
      }).success,
    ).toBe(false);
  });

  it("requires exactly seven call-prep sections and three weekly suggestions", () => {
    expect(
      a6CallPrepOutputSchema.safeParse({ ...validOutputs.A6, sections: [] })
        .success,
    ).toBe(false);
    expect(
      a8WeeklyReporterOutputSchema.safeParse({
        ...validOutputs.A8,
        suggestions: [],
      }).success,
    ).toBe(false);
  });
});
