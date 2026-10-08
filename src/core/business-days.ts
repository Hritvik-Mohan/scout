import { isoDateSchema } from "../models/common.js";

export interface BusinessCalendar {
  workingDays: readonly number[];
  holidays: readonly string[];
}

const validateCalendar = (calendar: BusinessCalendar): void => {
  if (
    calendar.workingDays.length === 0 ||
    calendar.workingDays.some(
      (day) => !Number.isInteger(day) || day < 1 || day > 7,
    )
  ) {
    throw new RangeError(
      "Business calendar must contain ISO weekdays from 1 to 7",
    );
  }
  for (const holiday of calendar.holidays) {
    isoDateSchema.parse(holiday);
  }
};

const toUtcDate = (date: string): Date => {
  const parsed = isoDateSchema.parse(date);
  return new Date(`${parsed}T00:00:00.000Z`);
};

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

const isoWeekday = (date: Date): number => {
  const utcDay = date.getUTCDay();
  return utcDay === 0 ? 7 : utcDay;
};

export const isBusinessDay = (
  date: string,
  calendar: BusinessCalendar,
): boolean => {
  validateCalendar(calendar);
  const instant = toUtcDate(date);
  return (
    calendar.workingDays.includes(isoWeekday(instant)) &&
    !new Set(calendar.holidays).has(date)
  );
};

export const addBusinessDays = (
  startDate: string,
  days: number,
  calendar: BusinessCalendar,
): string => {
  if (!Number.isInteger(days) || days < 0) {
    throw new RangeError("Business days must be a non-negative integer");
  }
  validateCalendar(calendar);

  const holidays = new Set(
    calendar.holidays.map((date) => isoDateSchema.parse(date)),
  );
  const workingDays = new Set(calendar.workingDays);
  const cursor = toUtcDate(startDate);
  let remaining = days;

  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const candidate = toIsoDate(cursor);
    if (workingDays.has(isoWeekday(cursor)) && !holidays.has(candidate)) {
      remaining -= 1;
    }
  }

  return toIsoDate(cursor);
};
