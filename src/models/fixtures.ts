import { z } from "zod";

import { isoDateTimeSchema, nonEmptyTextSchema, urlSchema } from "./common.js";
import {
  agentIdSchema,
  replyClassSchema,
  trackerSignalSchema,
} from "./enums.js";
import { PIPELINE_HEADERS, pipelineLeadSchema } from "./tracker.js";

const fixtureEnvelopeSchema = z
  .object({ schemaVersion: z.literal(1) })
  .strict();

export const sampleLeadsFixtureSchema = fixtureEnvelopeSchema.extend({
  records: z.array(pipelineLeadSchema).length(10),
});

export const labelledRepliesFixtureSchema = fixtureEnvelopeSchema.extend({
  records: z
    .array(
      z
        .object({
          messageId: nonEmptyTextSchema,
          receivedAt: isoDateTimeSchema,
          body: nonEmptyTextSchema,
          expectedClass: replyClassSchema,
        })
        .strict(),
    )
    .length(30),
});

export const buyingSignalsFixtureSchema = fixtureEnvelopeSchema.extend({
  records: z
    .array(
      z
        .object({
          signalId: nonEmptyTextSchema,
          company: nonEmptyTextSchema,
          signal: trackerSignalSchema,
          observedAt: isoDateTimeSchema,
          sourceUrl: urlSchema,
          excerpt: nonEmptyTextSchema,
        })
        .strict(),
    )
    .length(5),
});

export const historicalTranscriptsFixtureSchema = fixtureEnvelopeSchema.extend({
  records: z
    .array(
      z
        .object({
          transcriptId: nonEmptyTextSchema,
          occurredAt: isoDateTimeSchema,
          participants: z.array(z.enum(["buyer", "seller"])).min(2),
          transcript: nonEmptyTextSchema,
          expectedPackage: z.enum([
            "Discovery Sprint",
            "MVP Launch",
            "Product Acceleration",
            "Managed Pod",
          ]),
        })
        .strict(),
    )
    .length(3),
});

export const promptRegressionFixtureSchema = fixtureEnvelopeSchema.extend({
  records: z.array(
    z
      .object({
        caseId: nonEmptyTextSchema,
        agent: agentIdSchema,
        inputFixture: nonEmptyTextSchema,
        expectedSchema: nonEmptyTextSchema,
        snapshot: z.record(z.unknown()),
      })
      .strict(),
  ),
});

export const trackerWorkbookFixtureSchema = fixtureEnvelopeSchema
  .extend({
    headers: z.array(z.string()).length(PIPELINE_HEADERS.length),
    leadFixture: nonEmptyTextSchema,
  })
  .superRefine((fixture, context) => {
    const expected = new Set(PIPELINE_HEADERS);
    if (
      new Set(fixture.headers).size !== expected.size ||
      fixture.headers.some((header) => !expected.has(header as never))
    ) {
      context.addIssue({
        code: "custom",
        message: "headers must contain every Pipeline header exactly once",
        path: ["headers"],
      });
    }
  });

export type SampleLeadsFixture = z.infer<typeof sampleLeadsFixtureSchema>;
export type LabelledRepliesFixture = z.infer<
  typeof labelledRepliesFixtureSchema
>;
