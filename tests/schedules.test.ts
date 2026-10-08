import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import {
  buildPhaseZeroSchedules,
  getZonedParts,
  isWithinWorkingWindow,
} from "../src/scheduler/schedules.js";
import { validEnvironment } from "./fixtures/environment.js";

describe("Phase 0 schedules", () => {
  it("defines every future agent exactly once and keeps all schedules disabled", () => {
    const schedules = buildPhaseZeroSchedules(loadConfig(validEnvironment()));

    expect(schedules.map(({ agentId }) => agentId)).toEqual([
      "A1",
      "A2",
      "A3",
      "A4",
      "A5",
      "A6",
      "A7",
      "A8",
    ]);
    expect(schedules.map(({ enabled }) => enabled)).toEqual(
      Array(8).fill(false),
    );
    expect(schedules.every(({ timeZone }) => timeZone === "Asia/Kolkata")).toBe(
      true,
    );
  });

  it("preserves the fixed times from the specification", () => {
    const schedules = buildPhaseZeroSchedules(loadConfig(validEnvironment()));

    expect(schedules.find(({ agentId }) => agentId === "A1")?.trigger).toEqual({
      kind: "daily",
      localTime: "07:30",
    });
    expect(schedules.find(({ agentId }) => agentId === "A4")?.trigger).toEqual({
      kind: "daily",
      localTime: "11:00",
    });
    expect(schedules.find(({ agentId }) => agentId === "A8")?.trigger).toEqual({
      kind: "weekly",
      isoWeekday: 5,
      localTime: "17:00",
    });
  });
});

describe("timezone-aware working windows", () => {
  const config = loadConfig(validEnvironment());

  it("resolves an instant into the configured timezone", () => {
    expect(
      getZonedParts(new Date("2026-10-06T03:30:00.000Z"), "Asia/Kolkata"),
    ).toEqual({
      isoWeekday: 2,
      localMinutes: 9 * 60,
    });
  });

  it("includes the start and excludes the end of the working window", () => {
    expect(
      isWithinWorkingWindow(new Date("2026-10-06T03:30:00.000Z"), config),
    ).toBe(true);
    expect(
      isWithinWorkingWindow(new Date("2026-10-06T12:29:00.000Z"), config),
    ).toBe(true);
    expect(
      isWithinWorkingWindow(new Date("2026-10-06T12:30:00.000Z"), config),
    ).toBe(false);
  });

  it("excludes configured non-working days", () => {
    expect(
      isWithinWorkingWindow(new Date("2026-10-04T03:30:00.000Z"), config),
    ).toBe(false);
  });
});
