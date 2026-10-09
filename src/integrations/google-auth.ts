import { GoogleAuth } from "google-auth-library";

import type { AccessTokenProvider } from "./google-sheets.js";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export interface GoogleAccessTokenClient {
  getAccessToken(): Promise<string | null | undefined>;
}

export class GoogleAuthAccessTokenProvider implements AccessTokenProvider {
  constructor(
    private readonly auth: GoogleAccessTokenClient = new GoogleAuth({
      scopes: [SHEETS_SCOPE, DRIVE_FILE_SCOPE],
    }),
  ) {}

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
