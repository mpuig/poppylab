/**
 * Values in terms said as a person says them, in the conversation's
 * language: a delivery slot's code as its day and time ("sat-1230" is
 * "Saturday at 12:30"), a day of the week, a date, a month. Anything else
 * is said exactly as the terms give it.
 *
 * Plain data and no I/O.
 */
import type { Language } from "./language";

const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

/** The days of the week, Monday first, as each language writes them. */
const DAY_NAMES: Record<Language, readonly string[]> = {
  en: [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ],
  es: [
    "lunes",
    "martes",
    "miércoles",
    "jueves",
    "viernes",
    "sábado",
    "domingo",
  ],
  ca: [
    "dilluns",
    "dimarts",
    "dimecres",
    "dijous",
    "divendres",
    "dissabte",
    "diumenge",
  ],
  fr: ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"],
};

const MONTHS: Record<Language, readonly string[]> = {
  en: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ],
  es: [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ],
  ca: [
    "gener",
    "febrer",
    "març",
    "abril",
    "maig",
    "juny",
    "juliol",
    "agost",
    "setembre",
    "octubre",
    "novembre",
    "desembre",
  ],
  fr: [
    "janvier",
    "février",
    "mars",
    "avril",
    "mai",
    "juin",
    "juillet",
    "août",
    "septembre",
    "octobre",
    "novembre",
    "décembre",
  ],
};

/** A month, 1 to 12, by its name. */
export const monthIn = (language: Language, month: number) =>
  MONTHS[language][month - 1];

/**
 * A date ("2026-12-01") as a day and month, "1 December", with the year
 * only when it isn't this one. Nothing for anything that isn't a date.
 */
export function dateIn(language: Language, date: string, now = Date.now()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return undefined;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const name = monthIn(language, month);
  if (!name || day < 1 || day > 31) return undefined;
  const thisYear = new Date(now).getUTCFullYear() === year;
  const of = language === "ca" ? (/^[aeiou]/.test(name) ? "d'" : "de ") : "de ";
  const dayMonth = {
    en: `${day} ${name}`,
    es: `${day} de ${name}`,
    ca: `${day} ${of}${name}`,
    fr: `${day === 1 ? "1er" : day} ${name}`,
  }[language];
  if (thisYear) return dayMonth;
  return language === "en" || language === "fr"
    ? `${dayMonth} ${year}`
    : `${dayMonth} de ${year}`;
}

/** "sat-1230": a day of the week and a 24-hour time. */
const SLOT = /^(mon|tue|wed|thu|fri|sat|sun)-([01]\d|2[0-3])([0-5]\d)$/;

/**
 * A value as a person says it: a slot code as its day and time, a day of
 * the week in the language. Spanish and French put "el" or "le" before a
 * day, which `fromTo` joins with "de" and "a". Anything else as it is.
 */
export function valueIn(language: Language, value: string) {
  const slot = SLOT.exec(value);
  const index = slot
    ? DAYS.findIndex((d) => d.startsWith(slot[1]!))
    : DAYS.indexOf(value.toLowerCase() as (typeof DAYS)[number]);
  if (index < 0) return value;
  const day = DAY_NAMES[language][index]!;
  const time = slot ? `${slot[2]}:${slot[3]}` : undefined;
  if (!time)
    return { en: day, es: `el ${day}`, ca: day, fr: `le ${day}` }[language];
  return {
    en: `${day} at ${time}`,
    es: `el ${day} a las ${time}`,
    ca: `${day} a les ${time}`,
    fr: `le ${day} à ${time.replace(":", "h")}`,
  }[language];
}
