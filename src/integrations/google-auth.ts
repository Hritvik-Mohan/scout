import { GoogleAuth } from "google-auth-library";

import type { AccessTokenProvider } from "./google-sheets.js";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export interface GoogleAccessTokenClient {
  getAccessToken(): Promise<string | null | undefined>;
}

/**
 * Parses service-account credentials supplied inline, as raw JSON or base64.
 * Hosted environments have no key file, so the key arrives as a secret
 * environment variable instead of a GOOGLE_APPLICATION_CREDENTIALS path.
 */
export function parseInlineServiceAccount(
  value: string | undefined,
): Record<string, unknown> | undefined {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") return undefined;
  const json = trimmed.startsWith("{")
    ? trimmed
    : Buffer.from(trimmed, "base64").toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON must be service-account JSON or its base64 encoding",
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

const defaultAuth = (): GoogleAccessTokenClient => {
  const credentials = parseInlineServiceAccount(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
  );
  return new GoogleAuth({
    scopes: [SHEETS_SCOPE, DRIVE_FILE_SCOPE],
    ...(credentials === undefined ? {} : { credentials }),
  });
};

export class GoogleAuthAccessTokenProvider implements AccessTokenProvider {
  constructor(private readonly auth: GoogleAccessTokenClient = defaultAuth()) {}

  async getAccessToken(): Promise<string> {
    const token = await this.auth.getAccessToken();
    if (token === null || token === undefined || token.trim() === "") {
      throw new Error(
        "Google Application Default Credentials returned no token",
      );
    }
    return token;
  }
}
