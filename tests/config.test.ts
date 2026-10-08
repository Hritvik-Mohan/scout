import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig, redactEnvironment } from "../src/config.js";
import { validEnvironment } from "./fixtures/environment.js";

describe("loadConfig", () => {
  it("loads safe Phase 0 defaults", () => {
    const config = loadConfig(validEnvironment());

    expect(config.DRY_RUN).toBe(true);
    expect(config.TIMEZONE).toBe("Asia/Kolkata");
    expect(config.WORKING_DAYS).toEqual([1, 2, 3, 4, 5]);
    expect(config.HOLIDAY_DATES).toEqual([]);
    expect(config.CONCURRENCY).toBe(1);
    expect(config.MAX_NEW_LEADS_PER_DAY).toBe(20);
  });

  it("parses explicit booleans and integers", () => {
    const config = loadConfig({
      ...validEnvironment(),
      DRY_RUN: "false",
      MAX_DRAFTS_PER_DAY: "7",
      REQUIRE_APPROVAL_CHECKBOX: "true",
    });

    expect(config.DRY_RUN).toBe(false);
    expect(config.MAX_DRAFTS_PER_DAY).toBe(7);
    expect(config.REQUIRE_APPROVAL_CHECKBOX).toBe(true);
  });

  it("returns field-specific errors for missing required values", () => {
    expect.assertions(3);

    try {
      loadConfig({});
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).issues).toContainEqual({
        field: "TRACKER_SHEET_ID",
        message: "Required",
      });
      expect((error as Error).message).toContain("OWNER_EMAIL");
    }
  });

  it("rejects unsafe concurrency and invalid timezone values", () => {
    expect(() =>
      loadConfig({
        ...validEnvironment(),
        CONCURRENCY: "2",
        TIMEZONE: "Mars/Olympus_Mons",
      }),
    ).toThrow(/CONCURRENCY|TIMEZONE/);
  });

  it("rejects an inverted working window and fit thresholds", () => {
    expect(() =>
      loadConfig({
        ...validEnvironment(),
        MIN_FIT_TO_CONTACT: "1",
        MIN_FIT_TO_KEEP: "2",
        WORKING_HOURS_END: "08:00",
        WORKING_HOURS_START: "09:00",
      }),
    ).toThrow(/WORKING_HOURS_END|MIN_FIT_TO_CONTACT/);
  });

  it("rejects duplicate or out-of-range working days", () => {
    expect(() =>
      loadConfig({ ...validEnvironment(), WORKING_DAYS: "1,1,8" }),
    ).toThrow(/WORKING_DAYS/);
  });

  it("parses unique holiday dates and rejects impossible dates", () => {
    expect(
      loadConfig({
        ...validEnvironment(),
        HOLIDAY_DATES: "2026-10-20,2026-10-20,2026-12-25",
      }).HOLIDAY_DATES,
    ).toEqual(["2026-10-20", "2026-12-25"]);

    expect(() =>
      loadConfig({ ...validEnvironment(), HOLIDAY_DATES: "2026-02-30" }),
    ).toThrow(/HOLIDAY_DATES/);
  });
});

describe("redactEnvironment", () => {
  it("redacts likely secrets without hiding ordinary configuration", () => {
    expect(
      redactEnvironment({
        LLM_API_KEY: "secret-value",
        OAUTH_TOKEN: "token-value",
        TIMEZONE: "Asia/Kolkata",
      }),
    ).toEqual({
      LLM_API_KEY: "[REDACTED]",
      OAUTH_TOKEN: "[REDACTED]",
      TIMEZONE: "Asia/Kolkata",
    });
  });
});
