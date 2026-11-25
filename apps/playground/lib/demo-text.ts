/**
 * Protocol demo (no model): a Company's JSON answer as a few plain lines.
 * The demo has no model to put an answer into words, so it used to print the
 * raw JSON. This turns any answer into labelled lines a person can read; the
 * chat keeps the exact JSON one click away, under "Data".
 *
 * It knows nothing about any one Company: it reads the shape. Field names
 * become labels, amounts in cents become money, lists become bullets led by
 * each item's name, and bookkeeping (notes, versions, image links) is left
 * to the raw data.
 */
type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Bookkeeping a reader doesn't need; it stays in the raw data. */
const HIDDEN =
  /^(note|currency|image|images|version|revision|operation_id|expires_at|terms_url)$|_version$|_url$|_id$/;
/** The field that names an item, in order of preference. */
const TITLES = [
  "name",
  "label",
  "title",
  "flight_number",
  "booking_reference",
  "description",
  "summary",
  "day",
  "id",
];
const MONEY =
  /(^|_)(price|total|subtotal|fee|amount|balance|available|limit|paid|due|refund|cost|spent|delivery)(_|$)/;
/** What names a nested object when it has no name of its own (an airport). */
const PLACES = ["city", "code"];
const MAX_ITEMS = 8,
  MAX_FACTS = 8,
  MAX_LINES = 40;

const label = (key: string) => {
  const words = key
    .replace(/_cents$/, "")
    .replace(/_/g, " ")
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const money = (cents: number, currency: string) =>
  `${cents < 0 ? "−" : ""}${currency === "USD" ? "$" : ""}${(
    Math.abs(cents) / 100
  ).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}${currency && currency !== "USD" ? ` ${currency}` : ""}`;

/** One value on one line. `currency` is set where amounts are in cents. */
function scalar(key: string, value: unknown, currency: string | undefined) {
  if (typeof value === "number") {
    if (
      Number.isInteger(value) &&
      (key.endsWith("_cents") || (currency !== undefined && MONEY.test(key)))
    )
      return money(value, currency ?? "USD");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string") {
    // 2027-05-18T08:20:00-04:00 reads as 2027-05-18 08:20.
    const time = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value);
    if (time) return `${time[1]} ${time[2]}`;
    // on_time reads as "on time"; an identifier (ord_LNB1001) stays whole.
    return (
      /^[a-z]+(_[a-z]+)+$/.test(value) ? value.replace(/_/g, " ") : value
    ).slice(0, 160);
  }
  return "";
}

const shown = (object: Json) =>
  Object.entries(object).filter(
    ([key, value]) => !HIDDEN.test(key) && value !== null && value !== "",
  );
const currencyOf = (object: Json, inherited: string | undefined) =>
  typeof object.currency === "string" ? object.currency : inherited;

/** An object on one line: its name, then a few of its plain facts. */
function inline(object: Json, inherited: string | undefined): string {
  const currency = currencyOf(object, inherited);
  const titleKey = TITLES.find(
    (key) => typeof object[key] === "string" || typeof object[key] === "number",
  );
  const facts = shown(object)
    .filter(([key, value]) => key !== titleKey && !isObject(value))
    .map(([key, value]) =>
      Array.isArray(value)
        ? value.every((item) => !isObject(item)) && value.length
          ? `${label(key).toLowerCase()} ${value.slice(0, 4).join(", ")}`
          : ""
        : `${label(key).toLowerCase()} ${scalar(key, value, currency)}`,
    )
    .filter(Boolean)
    // An item's own ID adds nothing once it has a name.
    .filter((fact) => titleKey === "id" || !fact.startsWith("id "))
    .slice(0, MAX_FACTS);
  // A nested object that only names something ("slot": {"label": …}).
  const nested = shown(object)
    .filter(([, value]) => isObject(value))
    .map(([key, value]) => {
      const inner = value as Json;
      const name = [...TITLES, ...PLACES].find(
        (title) => title !== "id" && typeof inner[title] === "string",
      );
      return name ? `${label(key).toLowerCase()} ${String(inner[name])}` : "";
    })
    .filter(Boolean)
    .slice(0, 3);
  const title = titleKey ? scalar(titleKey, object[titleKey], currency) : "";
  return [title, [...facts, ...nested].join(" · ")].filter(Boolean).join(": ");
}

function lines(
  object: Json,
  inherited: string | undefined,
  depth: number,
): string[] {
  const currency = currencyOf(object, inherited);
  const out: string[] = [];
  for (const [key, value] of shown(object)) {
    if (Array.isArray(value)) {
      if (!value.length) {
        out.push(`${label(key)}: none`);
        continue;
      }
      if (value.every((item) => !isObject(item))) {
        out.push(`${label(key)}: ${value.slice(0, 12).join(", ")}`);
        continue;
      }
      out.push(`${label(key)} (${value.length}):`);
      for (const item of value.slice(0, MAX_ITEMS)) {
        if (!isObject(item)) out.push(`- ${String(item)}`);
        else if (depth === 0 && value.length <= 2) {
          // One or two items: room to show each in full, lists and all.
          const itemCurrency = currencyOf(item, currency);
          const titleKey = TITLES.find(
            (title) =>
              typeof item[title] === "string" ||
              typeof item[title] === "number",
          );
          out.push(
            `- ${titleKey ? scalar(titleKey, item[titleKey], itemCurrency) : label(key)}`,
          );
          // Its name leads; its own ID adds nothing beside a name.
          const rest = Object.fromEntries(
            Object.entries(item).filter(
              ([field]) => field !== titleKey && (field !== "id" || !titleKey),
            ),
          );
          out.push(...lines(rest, itemCurrency, 1).map((line) => `  ${line}`));
        } else out.push(`- ${inline(item, currency)}`);
      }
      if (value.length > MAX_ITEMS)
        out.push(`- …and ${value.length - MAX_ITEMS} more`);
    } else if (isObject(value)) {
      if (depth >= 1) out.push(`${label(key)}: ${inline(value, currency)}`);
      else {
        const inner = lines(value, currency, depth + 1);
        if (inner.length <= 3)
          out.push(`${label(key)}: ${inline(value, currency)}`);
        else out.push(`${label(key)}:`, ...inner.map((line) => `  ${line}`));
      }
    } else out.push(`${label(key)}: ${scalar(key, value, currency)}`);
  }
  return out;
}

/** A Company's answer in plain lines. */
export function readable(value: unknown): string {
  if (Array.isArray(value))
    return readable({ items: value }).replace(/^Items/, "Results");
  if (!isObject(value)) return value == null ? "No data." : String(value);
  // A change the Company holds: its own summary says it best.
  if (value.status === "approval_required" && typeof value.summary === "string")
    return `The company is holding this change until you approve it:\n${value.summary}`;
  if (typeof value.error === "string")
    return `The company answered with an error: ${value.error.replace(/_/g, " ")}${typeof value.message === "string" ? ` (${value.message})` : ""}.`;
  const out = lines(value, undefined, 0);
  if (!out.length) return "The company answered with no details.";
  return out.length > MAX_LINES
    ? [...out.slice(0, MAX_LINES), "…more under Data."].join("\n")
    : out.join("\n");
}
