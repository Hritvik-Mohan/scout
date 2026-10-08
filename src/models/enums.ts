import { z } from "zod";

export const AGENT_IDS = [
  "A0",
  "A1",
  "A2",
  "A3",
  "A4",
  "A5",
  "A6",
  "A7",
  "A8",
] as const;
export const PIPELINE_AGENT_IDS = [
  "A1",
  "A2",
  "A3",
  "A4",
  "A5",
  "A6",
  "A7",
  "A8",
] as const;
export const STAGES = [
  "New",
  "Researched",
  "Disqualified",
  "Drafted",
  "Contacted",
  "Replied",
  "Call booked",
  "Proposal drafted",
  "Proposal sent",
  "Won",
  "Lost",
  "Nurture",
] as const;
export const SOURCES = [
  "Warm intro",
  "Existing client",
  "NST placements",
  "Alumni",
  "Mentor network",
  "Funding news",
  "Job post",
  "Accelerator",
  "LinkedIn",
  "Upwork",
  "Inbound",
  "Agency partner",
  "Other",
] as const;
export const AGENT_SIGNALS = [
  "Funding round",
  "Contract dev job post",
  "Accelerator batch",
  "Public post asking for devs",
  "Manual operations",
  "Other",
] as const;
export const TRACKER_SIGNALS = [
  ...AGENT_SIGNALS,
  "Referral",
  "Phase 2",
] as const;
export const CASE_STUDIES = [
  "Zuvees",
  "IITR",
  "RishiVerse",
  "Maverick",
  "None",
] as const;
export const PACKAGES = [
  "Discovery Sprint",
  "MVP Launch",
  "Product Acceleration",
  "Managed Pod",
  "Unknown",
] as const;
export const CHANNELS = [
  "Email",
  "LinkedIn",
  "Phone",
  "WhatsApp",
  "In person",
] as const;
export const REPLY_CLASSES = [
  "interested",
  "question",
  "objection",
  "not_now",
  "referral",
  "unsubscribe",
  "out_of_office",
  "other",
] as const;
export const RUN_STATUSES = [
  "success",
  "partial",
  "failed",
  "skipped",
] as const;
export const SOURCE_TYPES = ["rss", "search_query", "job_search"] as const;
export const OUTBOUND_STATUSES = [
  "drafted",
  "sent",
  "superseded",
  "discarded",
] as const;

export const agentIdSchema = z.enum(AGENT_IDS);
export const pipelineAgentIdSchema = z.enum(PIPELINE_AGENT_IDS);
export const stageSchema = z.enum(STAGES);
export const sourceSchema = z.enum(SOURCES);
export const agentSignalSchema = z.enum(AGENT_SIGNALS);
export const trackerSignalSchema = z.enum(TRACKER_SIGNALS);
export const caseStudySchema = z.enum(CASE_STUDIES);
export const packageSchema = z.enum(PACKAGES);
export const channelSchema = z.enum(CHANNELS);
export const replyClassSchema = z.enum(REPLY_CLASSES);
export const runStatusSchema = z.enum(RUN_STATUSES);
export const sourceTypeSchema = z.enum(SOURCE_TYPES);
export const outboundStatusSchema = z.enum(OUTBOUND_STATUSES);

export type AgentId = z.infer<typeof agentIdSchema>;
export type PipelineAgentId = z.infer<typeof pipelineAgentIdSchema>;
export type Stage = z.infer<typeof stageSchema>;
export type ReplyClass = z.infer<typeof replyClassSchema>;
