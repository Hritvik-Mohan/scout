import { describe, expect, it, vi } from "vitest";

import {
  GoogleAuthAccessTokenProvider,
  parseInlineServiceAccount,
} from "../src/integrations/google-auth.js";

describe("GoogleAuthAccessTokenProvider", () => {
  it("returns a token supplied by Application Default Credentials", async () => {
    const getAccessToken = vi.fn().mockResolvedValue("short-lived-token");
    const provider = new GoogleAuthAccessTokenProvider({ getAccessToken });

    await expect(provider.getAccessToken()).resolves.toBe("short-lived-token");
    expect(getAccessToken).toHaveBeenCalledOnce();
  });

  it.each([null, undefined, ""])(
    "rejects an unusable token value: %s",
    async (token) => {
      const provider = new GoogleAuthAccessTokenProvider({
        getAccessToken: vi.fn().mockResolvedValue(token),
      });

      await expect(provider.getAccessToken()).rejects.toThrow(
        "Application Default Credentials returned no token",
      );
    },
  );
});

describe("parseInlineServiceAccount", () => {
  const key = { type: "service_account", client_email: "scout@example.test" };

  it("accepts raw JSON and base64", () => {
    expect(parseInlineServiceAccount(JSON.stringify(key))).toEqual(key);
    expect(
      parseInlineServiceAccount(
        Buffer.from(JSON.stringify(key)).toString("base64"),
      ),
    ).toEqual(key);
  });

  it("ignores an unset value and rejects malformed input", () => {
    expect(parseInlineServiceAccount(undefined)).toBeUndefined();
    expect(parseInlineServiceAccount("  ")).toBeUndefined();
    expect(() => parseInlineServiceAccount("not-a-key")).toThrow(
      /GOOGLE_SERVICE_ACCOUNT_JSON/u,
    );
  });
});
