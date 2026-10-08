import { z } from "zod";

import {
  isoDateTimeSchema,
  nonEmptyTextSchema,
  urlSchema,
} from "../models/common.js";
import type { SourceRow } from "../models/tracker.js";

export const DISCOVERY_MAX_RESULTS = 250;

export const discoveryDocumentSchema = z
  .object({
    documentId: nonEmptyTextSchema,
    sourceId: nonEmptyTextSchema,
    sourceName: nonEmptyTextSchema,
    sourceType: z.enum(["rss", "search_query"]),
    provider: nonEmptyTextSchema,
    queryOrUrl: nonEmptyTextSchema,
    segment: nonEmptyTextSchema,
    title: nonEmptyTextSchema,
    url: urlSchema,
    publishedAt: isoDateTimeSchema,
    retrievedAt: isoDateTimeSchema,
    summary: nonEmptyTextSchema.nullable(),
    publisherDomain: nonEmptyTextSchema.nullable(),
    language: nonEmptyTextSchema.nullable(),
    sourceCountry: nonEmptyTextSchema.nullable(),
  })
  .strict();

export interface DiscoveryWindow {
  startAt: Date;
  endAt: Date;
}

export interface DiscoveryRequest extends DiscoveryWindow {
  source: SourceRow;
  maxResults: number;
}

export interface DiscoveryAdapter {
  readonly provider: string;
  readonly sourceType: "rss" | "search_query";
  discover(request: DiscoveryRequest): Promise<readonly DiscoveryDocument[]>;
}

export class DiscoveryRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveryRequestError";
  }
}

export const assertDiscoveryRequest = (
  request: DiscoveryRequest,
  expectedSourceType: DiscoveryAdapter["sourceType"],
): void => {
  const { endAt, maxResults, source, startAt } = request;

  if (!source.active) {
    throw new DiscoveryRequestError(`source ${source.sourceId} is not active`);
  }
  if (source.type !== expectedSourceType) {
    throw new DiscoveryRequestError(
      `source ${source.sourceId} has type ${source.type}; expected ${expectedSourceType}`,
    );
  }
  if (Number.isNaN(startAt.valueOf()) || Number.isNaN(endAt.valueOf())) {
    throw new DiscoveryRequestError(
      "discovery window must contain valid dates",
    );
  }
  if (startAt >= endAt) {
    throw new DiscoveryRequestError("startAt must be earlier than endAt");
  }
  if (
    !Number.isInteger(maxResults) ||
    maxResults < 1 ||
    maxResults > DISCOVERY_MAX_RESULTS
  ) {
    throw new DiscoveryRequestError(
      `maxResults must be an integer from 1 to ${String(DISCOVERY_MAX_RESULTS)}`,
    );
  }
};

export const isInsideDiscoveryWindow = (
  publishedAt: Date,
  window: DiscoveryWindow,
): boolean => publishedAt >= window.startAt && publishedAt <= window.endAt;

export type DiscoveryDocument = z.infer<typeof discoveryDocumentSchema>;
