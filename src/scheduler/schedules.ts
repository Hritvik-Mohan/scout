import type { AppConfig } from "../config.js";
import { toMinutes } from "../config.js";
import type { PipelineAgentId } from "../models/enums.js";

export type ScheduleTrigger =
  | { kind: "daily"; localTime: string }
  | { kind: "weekly"; isoWeekday: number; localTime: string }
  | {
      kind: "interval";
      everyMinutes: number;
      window: "always" | "working_hours";
    }
  | { kind: "event"; source: "drive_transcript" };

export interface AgentSchedule {
  agentId: PipelineAgentId;
  enabled: false;
  timeZone: string;
  trigger: ScheduleTrigger;
}

export const buildPhaseZeroSchedules = (
  config: AppConfig,
): readonly AgentSchedule[] => [
  {
    agentId: "A1",
    enabled: false,
    timeZone: config.TIMEZONE,
    trigger: { kind: "daily", localTime: "07:30" },
  },
  {
    agentId: "A2",
    enabled: false,
    timeZone: config.TIMEZONE,
    trigger: { kind: "interval", everyMinutes: 60, window: "working_hours" },
  },
  {
    agentId: "A3",
    enabled: false,
    timeZone: config.TIMEZONE,
    trigger: { kind: "interval", everyMinutes: 60, window: "working_hours" },
  },
  {
    agentId: "A4",
    enabled: false,
    timeZone: config.TIMEZONE,
    trigger: { kind: "daily", localTime: "11:00" },
  },
  {
    agentId: "A5",
    enabled: false,
    timeZone: config.TIMEZONE,
    trigger: { kind: "interval", everyMinutes: 30, window: "working_hours" },
  },
  {
    agentId: "A6",
    enabled: false,
    timeZone: config.TIMEZONE,
    trigger: { kind: "interval", everyMinutes: 60, window: "always" },
  },
  {
    agentId: "A7",
    enabled: false,
    timeZone: config.TIMEZONE,
    trigger: { kind: "event", source: "drive_transcript" },
  },
  {
    agentId: "A8",
    enabled: false,
    timeZone: config.TIMEZONE,
    trigger: { kind: "weekly", isoWeekday: 5, localTime: "17:00" },
  },
];

interface ZonedParts {
  isoWeekday: number;
  localMinutes: number;
}

const isoWeekdayByShortName: Readonly<Record<string, number>> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export const getZonedParts = (instant: Date, timeZone: string): ZonedParts => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone,
    weekday: "short",
  }).formatToParts(instant);

  const partValue = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
    parts.find((part) => part.type === type)?.value;

  const weekday = partValue("weekday");
  const hours = Number(partValue("hour"));
  const minutes = Number(partValue("minute"));
  const isoWeekday =
    weekday === undefined ? undefined : isoWeekdayByShortName[weekday];

  if (
    isoWeekday === undefined ||
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes)
  ) {
    throw new Error(`Unable to resolve local time in timezone ${timeZone}`);
  }

  return { isoWeekday, localMinutes: hours * 60 + minutes };
};

export const isWithinWorkingWindow = (
  instant: Date,
  config: AppConfig,
): boolean => {
  const { isoWeekday, localMinutes } = getZonedParts(instant, config.TIMEZONE);
  return (
    config.WORKING_DAYS.includes(isoWeekday) &&
    localMinutes >= toMinutes(config.WORKING_HOURS_START) &&
    localMinutes < toMinutes(config.WORKING_HOURS_END)
  );
};
