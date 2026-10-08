import { z } from "zod";

import {
  domainOrUrlSchema,
  evidenceSchema,
  isoDateSchema,
  isoDateTimeSchema,
  leadIdSchema,
  nonEmptyTextSchema,
  nullableTextSchema,
  runIdSchema,
  urlSchema,
} from "./common.js";
import {
  agentIdSchema,
  caseStudySchema,
  channelSchema,
  outboundStatusSchema,
  packageSchema,
  replyClassSchema,
  runStatusSchema,
  sourceSchema,
  sourceTypeSchema,
  stageSchema,
  trackerSignalSchema,
} from "./enums.js";

export const HUMAN_PIPELINE_HEADERS = [
  "Company",
  "Website",
  "Contact",
  "Role",
  "Email / LinkedIn",
  "Source",
  "Signal",
  "Signal date",
  "Industry",
  "Case study",
  "Fit (1-5)",
  "Package",
  "Est. value (INR L)",
  "Stage",
  "Channel",
  "Touches",
  "Last touch",
  "Next action",
  "Next date",
  "Notes",
] as const;

export const SYSTEM_PIPELINE_HEADERS = [
  "Lead ID",
  "Email",
  "LinkedIn URL",
  "Signal URL",
  "Research summary",
  "Research sources",
  "Unverified notes",
  "Draft link",
  "LinkedIn draft",
  "Brief link",
  "Proposal link",
  "Gmail thread ID",
  "Reply class",
  "Approved",
  "Agent lock",
  "Last agent run",
  "Error",
] as const;

export const OPERATIONAL_PIPELINE_HEADERS = [
  "Active draft ID",
  "Last inbound message ID",
  "Last outbound message ID",
  "Evidence JSON link",
  "Stage changed at",
  "Stage changed by",
  "Processed transcript file ID",
] as const;

export const PIPELINE_HEADERS = [
  ...HUMAN_PIPELINE_HEADERS,
  ...SYSTEM_PIPELINE_HEADERS,
  ...OPERATIONAL_PIPELINE_HEADERS,
] as const;

const optionalText = nullableTextSchema.default(null);
const optionalUrl = urlSchema.nullable().default(null);
const optionalDate = isoDateSchema.nullable().default(null);
const optionalDateTime = isoDateTimeSchema.nullable().default(null);

export const pipelineLeadSchema = z
  .object({
    leadId: leadIdSchema,
    company: nonEmptyTextSchema,
    website: domainOrUrlSchema.nullable().default(null),
    contact: optionalText,
    role: optionalText,
    emailOrLinkedIn: optionalText,
    source: sourceSchema,
    signal: trackerSignalSchema,
    signalDate: optionalDate,
    industry: optionalText,
    caseStudy: caseStudySchema.default("None"),
    fit: z.number().int().min(1).max(5).nullable().default(null),
    package: packageSchema.default("Unknown"),
    estimatedValueInrLakhs: z.number().nonnegative().nullable().default(null),
    stage: stageSchema,
    channel: channelSchema.nullable().default(null),
    touches: z.number().int().nonnegative().default(0),
    lastTouch: optionalDate,
    nextAction: optionalText,
    nextDate: optionalDate,
    notes: z.string().default(""),
    email: z.string().email().nullable().default(null),
    linkedInUrl: optionalUrl,
    signalUrl: optionalUrl,
    researchSummary: optionalText,
    researchSources: z.array(urlSchema).default([]),
    unverifiedNotes: z.array(nonEmptyTextSchema).default([]),
    draftLink: optionalUrl,
    linkedInDraft: optionalText,
    briefLink: optionalUrl,
    proposalLink: optionalUrl,
    gmailThreadId: optionalText,
    replyClass: replyClassSchema.nullable().default(null),
    approved: z.boolean().default(false),
    agentLock: optionalText,
    lastAgentRun: optionalDateTime,
    error: optionalText,
    activeDraftId: optionalText,
    lastInboundMessageId: optionalText,
    lastOutboundMessageId: optionalText,
    evidenceJsonLink: optionalUrl,
    stageChangedAt: optionalDateTime,
    stageChangedBy: optionalText,
    processedTranscriptFileId: optionalText,
  })
  .strict();

export const runRowSchema = z
  .object({
    runId: runIdSchema,
    agent: agentIdSchema,
    started: isoDateTimeSchema,
    finished: isoDateTimeSchema,
    status: runStatusSchema,
    leadsProcessed: z.number().int().nonnegative(),
    leadIds: z.array(leadIdSchema),
    llmModel: optionalText,
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    error: optionalText,
    dryRun: z.boolean(),
    trigger: nonEmptyTextSchema,
    correlationId: z.string().uuid(),
  })
  .strict()
  .refine((row) => new Date(row.finished) >= new Date(row.started), {
    message: "finished must not be earlier than started",
    path: ["finished"],
  });

export const doNotContactRowSchema = z
  .object({
    emailOrDomain: nonEmptyTextSchema,
    normalizedValue: nonEmptyTextSchema,
    kind: z.enum(["email", "domain"]),
    added: isoDateSchema,
    reason: z.enum(["unsubscribe", "bounced", "manual"]),
    sourceLeadId: leadIdSchema.nullable().default(null),
    addedBy: nonEmptyTextSchema,
  })
  .strict();

export const capacityRowSchema = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "must use YYYY-MM"),
    availablePods: z.number().int().nonnegative(),
    committedPods: z.number().int().nonnegative(),
    updatedBy: nonEmptyTextSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const sourceRowSchema = z
  .object({
    sourceId: nonEmptyTextSchema,
    sourceName: nonEmptyTextSchema,
    type: sourceTypeSchema,
    queryOrUrl: nonEmptyTextSchema,
    segment: nonEmptyTextSchema,
    active: z.boolean(),
    lastSuccessfulFetch: optionalDateTime,
    cursorOrCheckpoint: optionalText,
    error: optionalText,
  })
  .strict();

export const outboundMessageRowSchema = z
  .object({
    outboundId: z.string().uuid(),
    leadId: leadIdSchema,
    touchNumber: z.number().int().positive(),
    channel: channelSchema,
    status: outboundStatusSchema,
    gmailDraftId: optionalText,
    gmailMessageId: optionalText,
    gmailThreadId: optionalText,
    createdAt: isoDateTimeSchema,
    sentDetectedAt: optionalDateTime,
    runId: runIdSchema,
  })
  .strict()
  .superRefine((row, context) => {
    if (row.status === "drafted" && row.gmailDraftId === null) {
      context.addIssue({
        code: "custom",
        message: "is required while status is drafted",
        path: ["gmailDraftId"],
      });
    }

    if (row.status === "sent" && row.sentDetectedAt === null) {
      context.addIssue({
        code: "custom",
        message: "is required while status is sent",
        path: ["sentDetectedAt"],
      });
    }
  });

export const dryRunOutputRowSchema = z
  .object({
    runId: runIdSchema,
    agent: agentIdSchema,
    leadId: leadIdSchema.nullable(),
    proposedOperation: nonEmptyTextSchema,
    target: nonEmptyTextSchema,
    proposedValue: z.unknown(),
    createdAt: isoDateTimeSchema,
  })
  .strict();

export const evidenceRecordSchema = evidenceSchema;

export type PipelineLead = z.infer<typeof pipelineLeadSchema>;
export type RunRow = z.infer<typeof runRowSchema>;
export type DoNotContactRow = z.infer<typeof doNotContactRowSchema>;
export type CapacityRow = z.infer<typeof capacityRowSchema>;
export type SourceRow = z.infer<typeof sourceRowSchema>;
export type OutboundMessageRow = z.infer<typeof outboundMessageRowSchema>;
export type DryRunOutputRow = z.infer<typeof dryRunOutputRowSchema>;
