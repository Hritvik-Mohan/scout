import { describe, expect, it, vi } from "vitest";

import { GoogleAuthAccessTokenProvider } from "../src/integrations/google-auth.js";

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
