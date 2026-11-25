/**
 * Deterministic hourly curves: each hour's watt-hours are a pure function
 * of the meter's seed and the hour, so the same hour always reads the same
 * whatever the date of the request, and nothing is stored. No randomness:
 * the variation comes from an integer hash of (seed, hour) and (seed, day).
 *
 * A home has a night base load, a morning and an evening peak, more at
 * midday on weekends, more in winter (lighting and heat) and air
 * conditioning on summer afternoons. The EV charger draws 7.2 kW from late
 * evening on most nights. Robin's panels produce around local noon, more in
 * summer and less on cloudy days: the home takes what they don't cover from
 * the grid (delivered) and sends the surplus back (received).
 */
import type { MeterSeed } from "./data.ts";
import { HOUR, localTime } from "./time.ts";

/** A 32-bit integer hash of two integers (a murmur-style finalizer). */
export function hash32(a: number, b: number) {
  let h = (a ^ Math.imul(b | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
/** A number in [0, 1) from the hash. */
const unit = (a: number, b: number) => hash32(a, b) / 4294967296;
const bell = (x: number, center: number, width: number) =>
  Math.exp(-(((x - center) / width) ** 2));
const YEAR = 365.25;
const season = (dayOfYear: number, peak: number) =>
  Math.cos((2 * Math.PI * (dayOfYear - peak)) / YEAR);

/** A home's consumption in the hour starting at `t`, in Wh. */
function homeLoad(seed: number, scale: number, t: number) {
  const { hour, weekday, dayOfYear, day } = localTime(t);
  const x = hour + 0.5;
  const weekend = weekday >= 6;
  const morning = weekend ? 520 * bell(x, 9.5, 1.6) : 600 * bell(x, 7.2, 1.2);
  const evening = 1050 * bell(x, 19.3, 1.9);
  const midday = (weekend ? 380 : 110) * bell(x, 13.5, 2.5);
  const winter = 1 + 0.28 * season(dayOfYear, 15);
  const cooling =
    650 * Math.max(0, season(dayOfYear, 205)) ** 2 * bell(x, 16.5, 2.4);
  const hourly = 0.85 + 0.3 * unit(seed, t / HOUR);
  const daily = 0.9 + 0.2 * unit(seed + 1, day);
  return (
    scale *
    ((260 + morning + evening + midday) * winter + cooling) *
    hourly *
    daily
  );
}

/**
 * The charger's draw: a session on the evening of a local day starts at
 * 22:00, 23:00 or midnight and charges 9 to 26 kWh at 7.2 kW. A quarter of
 * weeknights and half of weekend nights it isn't plugged in.
 */
function charger(seed: number, t: number) {
  const { hour, day } = localTime(t);
  const evening = hour < 12 ? day - 1 : day;
  const weekday = ((evening + 3) % 7) + 1; // 1970-01-01 was a Thursday.
  if (unit(seed, evening * 7 + 1) < (weekday >= 6 ? 0.5 : 0.25)) return 4;
  const start = 22 + Math.floor(unit(seed, evening * 7 + 2) * 3);
  const need = 9000 + Math.floor(unit(seed, evening * 7 + 3) * 17000);
  const since = (hour < 12 ? hour + 24 : hour) - start;
  if (since < 0 || since * 7200 >= need) return 4;
  return Math.min(7200, need - since * 7200);
}

/** The panels' output in the hour starting at `t`, in Wh. */
function solar(seed: number, panelWatts: number, t: number) {
  const { hour, dayOfYear, day, daylight } = localTime(t);
  const length = 12 + 3.2 * season(dayOfYear, 172);
  const noon = 12.5 + (daylight ? 1 : 0);
  const x = (hour + 0.5 - noon) / (length / 2);
  if (Math.abs(x) >= 1) return 0;
  const sun = 0.65 + 0.35 * season(dayOfYear, 172);
  const clouds = 0.3 + 0.7 * unit(seed + 7, day) ** 0.6;
  const flicker = 0.9 + 0.1 * unit(seed + 8, t / HOUR);
  return (
    panelWatts * Math.cos((x * Math.PI) / 2) ** 1.5 * sun * clouds * flicker
  );
}

/**
 * Watt-hours for one hour of a meter reading: `delivered` (flowDirection 1)
 * or `received` (flowDirection 19), as whole Wh.
 */
export function hourlyWh(meter: MeterSeed, flowDirection: 1 | 19, t: number) {
  const profile = meter.profile;
  switch (profile.kind) {
    case "home":
      return flowDirection === 1
        ? Math.round(homeLoad(profile.seed, profile.scale, t))
        : 0;
    case "ev":
      return flowDirection === 1 ? charger(profile.seed, t) : 0;
    case "solar-home": {
      const load = Math.round(homeLoad(profile.seed, profile.scale, t));
      const made = Math.round(solar(profile.seed, profile.panelWatts, t));
      return flowDirection === 1
        ? Math.max(0, load - made)
        : Math.max(0, made - load);
    }
  }
}
