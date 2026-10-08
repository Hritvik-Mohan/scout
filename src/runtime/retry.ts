import { ZodError } from "zod";

import {
  TrackerSchemaError,
  TrackerWriteError,
} from "../tracker/repository.js";

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETUNREACH",
]);

export interface RetryDecision {
  retry: boolean;
  category: "transient" | "permanent";
  reason: string;
}

export class TransientOperationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TransientOperationError";
  }
}

export class PermanentOperationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PermanentOperationError";
  }
}

function readNumericProperty(error: object, property: string): number | null {
  if (!(property in error)) return null;
  const value = Reflect.get(error, property) as unknown;
  return typeof value === "number" ? value : null;
}

function readStringProperty(error: object, property: string): string | null {
  if (!(property in error)) return null;
  const value = Reflect.get(error, property) as unknown;
  return typeof value === "string" ? value : null;
}

export function classifyRetry(error: unknown): RetryDecision {
  if (error instanceof TransientOperationError) {
    return { retry: true, category: "transient", reason: "explicit_transient" };
  }
  if (
    error instanceof PermanentOperationError ||
    error instanceof TrackerSchemaError ||
    error instanceof TrackerWriteError ||
    error instanceof ZodError
  ) {
    return { retry: false, category: "permanent", reason: "invalid_input" };
  }
  if (error instanceof Error && error.name === "AbortError") {
    return { retry: true, category: "transient", reason: "request_aborted" };
  }
  if (typeof error === "object" && error !== null) {
    const status =
      readNumericProperty(error, "status") ??
      readNumericProperty(error, "statusCode");
    if (status !== null) {
      if (RETRYABLE_HTTP_STATUSES.has(status)) {
        return {
          retry: true,
          category: "transient",
          reason: `http_${String(status)}`,
        };
      }
      if (status >= 400 && status < 500) {
        return {
          retry: false,
          category: "permanent",
          reason: `http_${String(status)}`,
        };
      }
    }
    const code = readStringProperty(error, "code");
    if (code !== null && RETRYABLE_ERROR_CODES.has(code)) {
      return { retry: true, category: "transient", reason: code.toLowerCase() };
    }
  }
  return { retry: false, category: "permanent", reason: "unclassified" };
}
