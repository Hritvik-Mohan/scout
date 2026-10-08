export interface DailyCapResult {
  allowed: boolean;
  current: number;
  limit: number;
  requested: number;
  remaining: number;
}

export const checkDailyCap = (
  current: number,
  limit: number,
  requested = 1,
): DailyCapResult => {
  if (![current, limit, requested].every(Number.isInteger)) {
    throw new TypeError("Daily cap inputs must be integers");
  }
  if (current < 0 || limit < 0 || requested < 1) {
    throw new RangeError("Daily cap inputs are outside the permitted range");
  }

  return {
    allowed: current + requested <= limit,
    current,
    limit,
    requested,
    remaining: Math.max(0, limit - current),
  };
};
