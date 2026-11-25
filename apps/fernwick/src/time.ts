/**
 * Fernwick's clock: ESPI times are whole seconds since 1970 UTC (`TimeType`),
 * days and billing months are UTC days and months, and the customers' local
 * time is Pacific time, described by `LocalTimeParameters` with US daylight
 * saving rules encoded as ESPI's 32-bit rule bitmap (`DstRuleType`).
 * Local time only shapes the usage curves and the time-of-use bands.
 */
export const HOUR = 3600,
  DAY = 86400;
/** Days of hourly history: today (UTC) and the 91 before it. */
export const HISTORY_DAYS = 92;

export const nowSeconds = () => Math.floor(Date.now() / 1000);
const mod = (n: number, m: number) => ((n % m) + m) % m;
export const dayStart = (t: number) => t - mod(t, DAY);
export const hourStart = (t: number) => t - mod(t, HOUR);
/** RFC 3339 in UTC, to the second: `2026-11-24T00:00:00Z`. */
export const rfc3339 = (t: number) =>
  new Date(t * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
/** The UTC calendar day, `YYYY-MM-DD`. */
export const isoDay = (t: number) =>
  new Date(t * 1000).toISOString().slice(0, 10);
export const monthStart = (t: number) => {
  const d = new Date(t * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
};
export const nextMonthStart = (t: number) => {
  const d = new Date(t * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
};

/**
 * The data that exists at `now`: hourly readings from the start of the
 * first of the 92 UTC days up to the last completed hour.
 */
export const historyOf = (now: number) => ({
  from: dayStart(now) - (HISTORY_DAYS - 1) * DAY,
  to: hourStart(now),
});

/**
 * One daylight saving rule in ESPI's bitmap: bits 0–11 seconds, 12–16
 * hours, 17–19 day of the week (1 Monday … 7 Sunday, 0 none), 20–24 day of
 * the month (0 none), 25–27 how the day is chosen, 28–31 month (1–12).
 */
export type DstRule = {
  month: number;
  /**
   * 0: that day of the month; 1: the weekday on or after that day; 2–6:
   * its first to fifth occurrence in the month; 7: its last occurrence.
   */
  operator: number;
  dayOfMonth: number;
  dayOfWeek: number;
  hours: number;
  seconds: number;
};
const FIELDS = [
  ["seconds", 0, 12],
  ["hours", 12, 5],
  ["dayOfWeek", 17, 3],
  ["dayOfMonth", 20, 5],
  ["operator", 25, 3],
  ["month", 28, 4],
] as const;
export function encodeDstRule(rule: DstRule) {
  let bits = 0;
  for (const [name, shift, width] of FIELDS) {
    const value = rule[name];
    if (!Number.isInteger(value) || value < 0 || value >= 2 ** width)
      throw new RangeError(name);
    bits += value * 2 ** shift;
  }
  return bits;
}
export function decodeDstRule(bits: number): DstRule {
  const rule = {} as Record<(typeof FIELDS)[number][0], number>;
  for (const [name, shift, width] of FIELDS)
    rule[name] = Math.floor(bits / 2 ** shift) % 2 ** width;
  return rule as DstRule;
}
/** As `HexBinary32` writes it: eight uppercase hex digits. */
export const ruleHex = (bits: number) =>
  bits.toString(16).toUpperCase().padStart(8, "0");

/** US Pacific time: UTC−8, one hour more from March to November. */
export const PACIFIC = {
  id: "LTP-PACIFIC",
  name: "Pacific time (US daylight saving rules)",
  tzOffset: -8 * HOUR,
  dstOffset: HOUR,
  // The second Sunday of March at 02:00 local standard time.
  dstStartRule: encodeDstRule({
    month: 3,
    operator: 3,
    dayOfMonth: 0,
    dayOfWeek: 7,
    hours: 2,
    seconds: 0,
  }),
  // The first Sunday of November at 02:00 local daylight time.
  dstEndRule: encodeDstRule({
    month: 11,
    operator: 2,
    dayOfMonth: 0,
    dayOfWeek: 7,
    hours: 2,
    seconds: 0,
  }),
} as const;
export type LocalTimeParameters = {
  tzOffset: number;
  dstOffset: number;
  dstStartRule: number;
  dstEndRule: number;
};

/** ISO weekday of a UTC day: 1 Monday … 7 Sunday. */
const weekday = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
const daysIn = (y: number, m: number) =>
  new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The day of the month a rule falls on in `year`. */
export function ruleDay(rule: DstRule, year: number) {
  const { month, operator, dayOfMonth, dayOfWeek } = rule;
  if (operator === 0) return dayOfMonth;
  const after = (from: number) =>
    from + ((dayOfWeek - weekday(year, month, from) + 7) % 7);
  if (operator === 1) return after(dayOfMonth);
  if (operator === 7) {
    const last = daysIn(year, month);
    return last - ((weekday(year, month, last) - dayOfWeek + 7) % 7);
  }
  return after(1) + 7 * (operator - 2);
}

/**
 * When a rule takes effect in `year`, in UTC seconds: its wall-clock time
 * read in the offset in force just before it (standard time for the start,
 * daylight time for the end).
 */
export function ruleInstant(bits: number, year: number, offsetBefore: number) {
  const rule = decodeDstRule(bits);
  const wall =
    Date.UTC(year, rule.month - 1, ruleDay(rule, year)) / 1000 +
    rule.hours * HOUR +
    rule.seconds;
  return wall - offsetBefore;
}

/** The offset from UTC at instant `t`, daylight saving included. */
export function localOffset(t: number, p: LocalTimeParameters = PACIFIC) {
  const year = new Date((t + p.tzOffset) * 1000).getUTCFullYear();
  const start = ruleInstant(p.dstStartRule, year, p.tzOffset);
  const end = ruleInstant(p.dstEndRule, year, p.tzOffset + p.dstOffset);
  return t >= start && t < end ? p.tzOffset + p.dstOffset : p.tzOffset;
}

/** Local wall-clock facts of instant `t`, for the curves and the bands. */
export function localTime(t: number) {
  const offset = localOffset(t);
  const local = new Date((t + offset) * 1000);
  const start = Date.UTC(local.getUTCFullYear(), 0, 1);
  return {
    hour: local.getUTCHours(),
    weekday: local.getUTCDay() || 7,
    dayOfYear: Math.floor((local.getTime() - start) / 86400000),
    /** Days since 1970 of the local calendar day. */
    day: Math.floor(local.getTime() / 86400000),
    daylight: offset !== PACIFIC.tzOffset,
  };
}
