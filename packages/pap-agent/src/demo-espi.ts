/**
 * Protocol demo (no model) with Use ESPI on: a request about electricity
 * usage or bills goes to the native ESPI-shaped tools (`poppylab.dev/espi`
 * v1) instead of the Company's own API. They exist only with Use ESPI on,
 * so the tools decide, never the Company's name. The demo invents no meter
 * id: it lists the meters the User shared, then reads each one's last seven
 * days or its bills. The tools have added the hourly intervals up already.
 */
type Tool = { execute: (input?: Record<string, unknown>) => Promise<unknown> };
export type EspiDemoTools = Record<string, Tool | undefined>;
export type EspiDemoRead = "usage" | "bills";

/** Meters one demo answer reads. */
const METERS = 3;
/** Days of usage one demo answer reads: the week before today. */
const DAYS = 7;

/**
 * Bills, by word stem: bill, billed, factura, facturas, recibo; and money
 * paid ("pay", "paid", "pagué", "pagado"), which at a utility is what was
 * billed. Checked first, so "my last electricity bill" is a bill.
 */
const BILLS = /\b(?:bill|factur|recibo|invoice|pay|paid|pag[aoóué])/;
/**
 * Usage, by word stem: consumo, consumido, consumption; electricity,
 * eléctrico, electricidad; energy, energía; kWh; usage, use, used, uso; luz.
 * "Gastar" and "spend" are left out: "¿Cuánto gasté el mes pasado?" is as
 * likely a bill as a week's energy, so it falls through to the own API.
 */
const USAGE =
  /\b(?:consum|electri|eléctri|energ|usage|uses?\b|used\b|usos?\b|luz\b)|kwh/;

/** Which read the message asks for, if the ESPI-shaped tools can answer it. */
export function demoEspiRead(
  message: string,
  tools: EspiDemoTools,
): EspiDemoRead | undefined {
  if (!tools.espi_meters) return undefined;
  const lowered = message.toLowerCase();
  if (tools.espi_bills && BILLS.test(lowered)) return "bills";
  if (tools.espi_usage && USAGE.test(lowered)) return "usage";
  return undefined;
}

const refused = (value: unknown) =>
  !!value &&
  typeof value === "object" &&
  typeof (value as { error?: unknown }).error === "string";
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
/**
 * The utility reads days in its own time zone, which the demo doesn't
 * know. Yesterday in UTC can still be today where the meter is (UTC-12
 * at the furthest), so the last day asked for is one that has ended
 * everywhere: it is never cut short.
 */
const lastDay = (now: number) => now - (24 + 12) * 3600000;

/**
 * Reads with the ESPI-shaped tools: the shared meters, then for each one
 * the last seven days, day by day, or its bills. An error answer is
 * returned as it is.
 */
export async function demoEspiAnswer(
  kind: EspiDemoRead,
  tools: EspiDemoTools,
  now = Date.now(),
) {
  const listed = await tools.espi_meters!.execute({});
  if (refused(listed)) return listed;
  const points = (listed as { usagePoints?: unknown }).usagePoints;
  const ids = (Array.isArray(points) ? points : [])
    .map((p) => (p as { usagePointId?: unknown } | null)?.usagePointId)
    .filter((id): id is string => typeof id === "string")
    .slice(0, METERS);
  const read = [];
  for (const usagePointId of ids)
    read.push(
      kind === "usage"
        ? await tools.espi_usage!.execute({
            usagePointId,
            from: day(lastDay(now) - (DAYS - 1) * 86400000),
            to: day(lastDay(now)),
          })
        : await tools.espi_bills!.execute({ usagePointId }),
    );
  return { [kind]: read };
}

const text = (value: unknown) =>
  typeof value === "string" && value ? value : undefined;
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
function money(amount: unknown, currency: unknown) {
  const value = number(amount);
  if (value === undefined) return undefined;
  const code = text(currency) ?? "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
    }).format(value);
  } catch {
    return `${value} ${code}`;
  }
}
const kWh = (value: unknown) => {
  const v = number(value);
  return v === undefined
    ? undefined
    : `${v.toLocaleString("en-US", { maximumFractionDigits: 3 })} kWh`;
};
/** An hour's local start, `2026-11-18T00:00-08:00`, as `2026-11-18 00:00 (UTC-08:00)`. */
const hour = (value: unknown) => {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})([+-]\d{2}:\d{2})$/.exec(
    text(value) ?? "",
  );
  return match ? `${match[1]} ${match[2]} (UTC${match[3]})` : text(value);
};
const meterName = (m: Record<string, unknown>) =>
  [
    text(m.title) ?? text(m.usagePointId) ?? "Meter",
    text(m.title) && text(m.usagePointId) ? `(${m.usagePointId})` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
const list = (value: unknown) =>
  (Array.isArray(value) ? value : []).filter(
    (v): v is Record<string, unknown> => !!v && typeof v === "object",
  );

/** One meter's usage: each reading's days and total. */
function usageLines(meter: Record<string, unknown>) {
  const lines = [
    `${meterName(meter)}, ${text(meter.from)} to ${text(meter.to)}:`,
  ];
  for (const reading of list(meter.meterReadings)) {
    const name = [text(reading.title), text(reading.direction)]
      .filter(Boolean)
      .join(", ");
    if (text(reading.skipped)) {
      lines.push(`  ${name}: ${reading.skipped}`);
      continue;
    }
    lines.push(`  ${name}:`);
    const currency = reading.currency;
    for (const d of list(reading.days))
      lines.push(
        `  - ${[text(d.date), kWh(d.kWh), money(d.cost, currency)].filter(Boolean).join(" · ")}`,
      );
    const total = (reading.total ?? {}) as Record<string, unknown>;
    lines.push(
      `  Total ${[kWh(total.kWh), money(total.cost, currency)].filter(Boolean).join(" · ")}${number(total.intervals) ? ` over ${total.intervals} hours` : ""}`,
    );
    const [top] = list(reading.topHours);
    if (top)
      lines.push(
        `  Highest hour: ${[hour(top.start), kWh(top.kWh)].filter(Boolean).join(" · ")}`,
      );
    if (number(reading.daysWithoutData))
      lines.push(`  ${reading.daysWithoutData} days without data.`);
  }
  if (meter.truncated === true)
    lines.push("  Not everything was read: ask for a shorter period.");
  return lines;
}

/** One meter's bills: period, energy, amount and tariff. */
function billLines(meter: Record<string, unknown>) {
  const lines = [`${meterName(meter)}:`];
  const bills = list(meter.bills);
  if (!bills.length) lines.push("  No bills in the last 92 days.");
  for (const b of bills) {
    const period = (b.period ?? {}) as Record<string, unknown>;
    const dates =
      text(period.from) && text(period.to)
        ? `${period.from} to ${period.to}${text(period.timeZone) ? ` (${period.timeZone})` : ""}`
        : text(b.title);
    lines.push(
      `  - ${[dates, kWh(b.kWh), money(b.amount, b.currency), text(b.tariff)].filter(Boolean).join(" · ")}`,
    );
  }
  if (meter.truncated === true)
    lines.push("  More bills exist: ask for a shorter period.");
  return lines;
}

/**
 * A readable answer for the shapes `demoEspiAnswer` returns, or undefined
 * for anything else (the caller then shows the raw answer).
 */
export function formatEspi(answer: unknown): string | undefined {
  if (!answer || typeof answer !== "object" || refused(answer))
    return undefined;
  const { usage, bills } = answer as { usage?: unknown; bills?: unknown };
  const meters = Array.isArray(usage) ? usage : bills;
  if (!Array.isArray(meters)) return undefined;
  if (!meters.length) return "No shared meters.";
  const lines: string[] = [];
  for (const meter of meters as unknown[]) {
    if (!meter || typeof meter !== "object") continue;
    if (refused(meter)) {
      lines.push(`- ${(meter as { error: string }).error}`);
      continue;
    }
    lines.push(
      ...(Array.isArray(usage)
        ? usageLines(meter as Record<string, unknown>)
        : billLines(meter as Record<string, unknown>)),
    );
  }
  return lines.join("\n");
}

/** What the demo says around the answer. */
export function demoEspiReply(answer: unknown, show: (v: unknown) => string) {
  // `show` also keeps the exact answer for "Data"; the words are ours.
  const raw = show(answer);
  const shown = formatEspi(answer) ?? raw;
  const error = refused(answer) ? (answer as { error: string }).error : "";
  const hint =
    error === "sign_in_required"
      ? "Sign in first; the utility's consent page asks which meters to share. "
      : error === "insufficient_scope"
        ? "This sign-in doesn't include the ESPI-shaped scopes: sign in again with Use ESPI on. "
        : error === "subscription_unknown"
          ? "This sign-in has no ESPI-shaped subscription: sign in again with Use ESPI on. "
          : "";
  return `Protocol demo (no LLM). Read through the ESPI-shaped tools (poppylab.dev/espi v1), with only the meters you shared; the hourly readings are added up before anything is shown:\n\n${shown}\n\n${hint}Turn Use ESPI off to read through the Company's own API instead. For natural-language reasoning, select a model.`;
}
