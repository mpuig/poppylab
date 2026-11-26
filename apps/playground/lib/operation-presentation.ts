import { readable } from "./demo-text";

export type ReviewOperation = {
  operation_id: string;
  revision: string;
  state: string;
  summary?: string;
  terms?: Record<string, unknown>;
  expires_at: string;
  result?: { summary: string } | null;
  /** Who approved it: the User, or Iris on their standing instruction. */
  approvedBy?: {
    approver: "user" | "agent";
    rule?: string;
    reference?: string;
  };
  /** The Company declined an approval on the standing instruction (§6). */
  agentDeclined?: { reason?: string };
  /** The Company answered one with new terms instead (§5). */
  agentSuperseded?: true;
  /**
   * An approval was sent and nothing was performed: the Company `refused`
   * it, or answered it with these `new_terms` (see `Operation` in
   * `runtime.ts`).
   */
  notPerformed?: "refused" | "new_terms";
};
/** The full stop a Company's words still need to end a sentence, if any. */
const stop = (words: string) => (/[.!?…]["'”’)\]]*$/.test(words) ? "" : ".");
/**
 * The Company's reason for declining Iris's approval, quoted as a sentence
 * that follows another: " It says: “…”". The reason usually ends its own
 * sentence inside the quotation marks; a full stop is added after them only
 * when it doesn't, so the line is punctuated once. Nothing without a reason.
 */
export function declinedReason(reason: string | undefined) {
  const words = reason?.trim();
  if (!words) return "";
  return ` It says: “${words}”${stop(words)}`;
}
/**
 * The same reason where it isn't quoted, in the sentences the account route
 * writes for a card and for the model: " Its reason: …", ended once whether
 * or not the reason ends its own sentence. Nothing without a reason.
 */
export function statedReason(reason: string | undefined) {
  const words = reason?.trim();
  return words ? ` Its reason: ${words}${stop(words)}` : "";
}
export function money(cents: unknown, currency: unknown) {
  if (typeof cents !== "number" || !Number.isFinite(cents))
    return "Not provided";
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency))
    return `${cents} cents (currency not provided)`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}
export function termValue(
  key: string,
  value: unknown,
  terms: Record<string, unknown>,
): string {
  if (key.endsWith("_cents")) return money(value, terms.currency);
  if (value === null || value === undefined) return "Not provided";
  if (Array.isArray(value)) {
    return value.length
      ? value
          .map((item) => {
            if (item && typeof item === "object" && !Array.isArray(item)) {
              const p = item as Record<string, unknown>;
              if (p.name)
                return `${p.quantity ?? "—"} × ${String(p.name)}${p.unit ? ` (${p.unit})` : ""}${typeof p.line_total_cents === "number" ? ` · ${money(p.line_total_cents, terms.currency)}` : ""}`;
            }
            return termValue("", item, terms);
          })
          .join("\n")
      : "No items";
  }
  if (typeof value === "object")
    return Object.entries(value)
      .map(([k, v]) => `${k.replaceAll("_", " ")}: ${termValue(k, v, terms)}`)
      .join("; ");
  return String(value);
}
export function changes(op: ReviewOperation) {
  const t = op.terms ?? {};
  if (typeof t.from_slot === "string" && typeof t.to_slot === "string")
    return t.from_slot === t.to_slot
      ? []
      : [{ label: "Delivery slot", before: t.from_slot, after: t.to_slot }];
  if (
    t.kind === "support_resolution" &&
    typeof t.from_status === "string" &&
    typeof t.to_status === "string"
  )
    return [
      {
        label: "Case status",
        before: String(t.from_status ?? "Not provided"),
        after: String(t.to_status ?? "Not provided"),
      },
    ];
  if (t.kind === "profile_change") {
    const before = (
        t.before_profile && typeof t.before_profile === "object"
          ? t.before_profile
          : {}
      ) as Record<string, unknown>,
      after = (
        t.after_profile && typeof t.after_profile === "object"
          ? t.after_profile
          : {}
      ) as Record<string, unknown>;
    return (
      [
        ["name", "Name"],
        ["email", "Test email"],
        ["address", "Future delivery address"],
      ] as const
    ).map(([key, label]) => ({
      label,
      before:
        typeof before[key] === "string" ? String(before[key]) : "Not provided",
      after:
        typeof after[key] === "string" ? String(after[key]) : "Not provided",
    }));
  }
  if (t.kind === "delivery")
    return [
      {
        label: "Recurring delivery day",
        before: String(t.from ?? "Not provided"),
        after: String(t.to ?? "Not provided"),
      },
    ];
  if (t.kind === "basket" || t.kind === "delivery_items")
    return [
      {
        label: `${t.kind === "basket" ? "Basket" : "Recurring delivery"} · ${String(t.product_name ?? t.product_id ?? "Item")}`,
        before:
          t.from_quantity === undefined
            ? "Not provided"
            : `${t.from_quantity} ${t.unit ?? "unit(s)"}`,
        after:
          t.quantity === 0 ? "Removed" : `${t.quantity} ${t.unit ?? "unit(s)"}`,
      },
    ];
  return [];
}
export function operationTitle(op: ReviewOperation) {
  const t = op.terms ?? {};
  return t.kind === "profile_change"
    ? "Update fictional profile"
    : t.kind === "support_case"
      ? "Open support request"
      : t.kind === "support_resolution"
        ? "Close support case"
        : // Only where the refund is the amount the card leads with: a flight
          // change that charges also carries a refund of zero.
          approvalTotal(op)?.key === "refund_cents"
          ? "Review refund"
          : t.booking_id
            ? "Review booking change"
            : t.order_id
              ? "Review order change"
              : t.kind === "checkout"
                ? "Review checkout"
                : t.kind === "delivery"
                  ? "Change delivery day"
                  : t.kind === "basket"
                    ? "Update basket"
                    : t.kind === "delivery_items"
                      ? "Update recurring delivery"
                      : "Review Company proposal";
}
/**
 * The fields that can hold the amount an approval is about, most specific
 * first. `amount_due_cents` is what this approval charges, even beside a
 * total. `amount_cents` is what a payment or a transfer moves. The totals
 * are what an order comes to. A refund comes last: it leads only where
 * nothing is paid. No other field is ever the amount: a balance says what
 * an account holds, a "before" value what was already so, and a fee or a
 * difference is part of the price.
 */
const AMOUNT_KEYS = [
  "amount_due_cents",
  "amount_cents",
  "new_total_cents",
  "total_cents",
  "refund_cents",
];
/** A field's name as a label: `amount_due_cents` reads "Amount due". */
export const fieldLabel = (key: string) => {
  const words = key
    .replace(/_cents$/, "")
    .replace(/_/g, " ")
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};
/**
 * The amount an approval commits the User to, from the Company's own terms:
 * the first of `AMOUNT_KEYS` that holds one, labelled by its field. A zero
 * gives way to a later field that holds an amount (a flight change with
 * nothing due and a refund), and a negative number is not an amount paid.
 */
export function approvalTotal(op: ReviewOperation) {
  const t = op.terms ?? {};
  const held = AMOUNT_KEYS.filter((key) => {
    const value = t[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
  });
  const key = held.find((name) => t[name] !== 0) ?? held[0];
  if (!key) return null;
  return {
    key,
    label: money(t[key], t.currency),
    // Lantern's new total has always led its card as "Total".
    text: key === "new_total_cents" ? "Total" : fieldLabel(key),
  };
}
/**
 * The amount the card leads with and puts on its Approve button: what
 * approving pays, moves or refunds. That is `approvalTotal`, except for an
 * order's new total that is no more than the total before. A change that
 * lowers the total returns money and one that keeps it costs nothing, so
 * "Approve $37.00" would name a payment nobody makes. The card then names
 * no amount; its rows still give both totals and the difference.
 */
export function amountToApprove(op: ReviewOperation) {
  const total = approvalTotal(op);
  const t = op.terms ?? {};
  return total?.key === "new_total_cents" &&
    typeof t.before_total_cents === "number" &&
    Number(t.new_total_cents) <= t.before_total_cents
    ? null
    : total;
}
/** Juniper's kinds of change, each with its own layout on the card. */
const KINDS = new Set([
  "profile_change",
  "support_case",
  "support_resolution",
  "delivery",
  "basket",
  "delivery_items",
  "checkout",
]);
/**
 * Whether the card lays these terms out itself: Juniper's kinds, and
 * Lantern's order change and refund. Any other terms are read from their
 * shape, by `termRows`.
 */
export function ownLayout(op: ReviewOperation) {
  const t = op.terms ?? {};
  return (
    (typeof t.kind === "string" && KINDS.has(t.kind)) ||
    (typeof t.from_slot === "string" && typeof t.to_slot === "string") ||
    (typeof t.order_id === "string" && typeof t.refund_cents === "number")
  );
}
/** Bookkeeping a reader doesn't need, as in `demo-text`, and request keys. */
const HIDDEN =
  /^(note|currency|image|images|version|revision|operation_id|expires_at|terms_url)$|_version$|_url$|_id$|(^|_)key$/;
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const BEFORE = /_before(?=_|$)/,
  AFTER = /_after(?=_|$)/;
/** The two fields of a change, when a field's name says it is one of them. */
export function sides(key: string) {
  if (key === "from" || key === "to")
    return { name: "", from: "from", to: "to" };
  if (key.startsWith("from_"))
    return { name: key.slice(5), from: key, to: `to_${key.slice(5)}` };
  if (key.startsWith("to_"))
    return { name: key.slice(3), from: `from_${key.slice(3)}`, to: key };
  if (BEFORE.test(key))
    return {
      name: key.replace(BEFORE, ""),
      from: key,
      to: key.replace(BEFORE, "_after"),
    };
  if (AFTER.test(key))
    return {
      name: key.replace(AFTER, ""),
      from: key.replace(AFTER, "_before"),
      to: key,
    };
  return undefined;
}
/**
 * Any Company's terms as rows, read from their shape alone. A field's name
 * is its label and `*_cents` is money. Two fields named as a pair (`from_x`
 * and `to_x`, `x_before` and `x_after`, or `from` and `to` holding the same
 * fields) are one change, before and after. Bookkeeping is left to the
 * exact terms. Lists and nested fields are put into lines by the reader the
 * protocol demo uses for a Company's answers. Nothing here says what a field
 * means beyond its name.
 */
export function termRows(op: ReviewOperation) {
  const t = op.terms ?? {};
  const changes: { label: string; before: string; after: string }[] = [];
  const rows: { key: string; label: string; value: string }[] = [];
  for (const [key, value] of Object.entries(t)) {
    const side = sides(key);
    if (side && side.from in t && side.to in t && !HIDDEN.test(side.name)) {
      const before = t[side.from],
        after = t[side.to];
      if (side.name) {
        // Shown once, where the terms name its first half.
        if (key === side.from)
          changes.push({
            label: fieldLabel(side.name),
            before: termValue(side.from, before, t),
            after: termValue(side.to, after, t),
          });
        continue;
      }
      if (isObject(before) && isObject(after)) {
        // `from` and `to` hold the same fields: each field is one change.
        if (key === side.from)
          for (const field of new Set([
            ...Object.keys(before),
            ...Object.keys(after),
          ]))
            if (!HIDDEN.test(field))
              changes.push({
                label: fieldLabel(field),
                before: termValue(field, before[field], t),
                after: termValue(field, after[field], t),
              });
        continue;
      }
    }
    if (HIDDEN.test(key) || value === null || value === "") continue;
    if (typeof value !== "object") {
      rows.push({
        key,
        label: fieldLabel(key),
        value: termValue(key, value, t),
      });
      continue;
    }
    // A list or nested fields: the demo's reader writes "Label: …" and any
    // further lines. An unknown currency is left out, not taken for dollars.
    const currency =
      typeof t.currency === "string" && /^[A-Z]{3}$/.test(t.currency)
        ? t.currency
        : "";
    const text = readable({ [key]: value, currency });
    const lines = text.slice(text.indexOf(":") + 1).trim();
    if (lines) rows.push({ key, label: fieldLabel(key), value: lines });
  }
  return { changes, rows };
}
/**
 * Where a summary names an amount the terms do not contain. The summary is
 * the Company's wording and the terms are what it commits to, so a summary
 * that quotes only other figures is worth a second look before approving.
 */
export function summaryDisagreements(op: ReviewOperation): string[] {
  const t = op.terms ?? {};
  const cents = Object.entries(t).flatMap(([key, value]) =>
    key.endsWith("_cents") && typeof value === "number" ? [value] : [],
  );
  if (!op.summary || !cents.length) return [];
  const named = [
    ...op.summary.matchAll(/[$€£]\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?/g),
  ].map((m) =>
    Math.round(
      Number(
        `${(m[1] ?? "0").replaceAll(",", "")}.${(m[2] ?? "0").padEnd(2, "0")}`,
      ) * 100,
    ),
  );
  return named
    .filter((amount) => !cents.includes(amount))
    .map(
      (amount) =>
        `The summary mentions ${money(amount, typeof t.currency === "string" ? t.currency : "USD")}, which is not one of the amounts in the terms.`,
    )
    .filter((line, index, all) => all.indexOf(line) === index);
}

/** Whether an operation still waits for the User: open and in time, or unresolved. */
export function needsYou(op: ReviewOperation, now = Date.now()) {
  return (
    op.state === "uncertain" ||
    (op.state === "proposed" && Date.parse(op.expires_at) > now)
  );
}

/**
 * The waiting operations in the order "Needs you" lists them. One card is
 * open at a time and it comes last, so the others are closed lines above it
 * and the buttons at the panel's foot are always its own. It is the one the
 * User opened, or the first to arrive while that one is not waiting.
 */
export function openLast<T extends { operation_id: string }>(
  waiting: T[],
  chosen?: string,
): T[] {
  const last = waiting.find((op) => op.operation_id === chosen) ?? waiting[0];
  return last ? [...waiting.filter((op) => op !== last), last] : [];
}

/** What the account route records when a Company's result has no summary. */
const NO_SUMMARY = "The Company performed the approved operation.";
/**
 * How a finished operation ended, for its entry in the transcript, so it
 * reads without opening it. `says` is the Company's own result sentence, to
 * show as its words. `note` is Poppy's: who approved, why nothing was done,
 * or what the User can do next. `state` is the state the card shows, where a
 * proposal past its expiry is already "expired".
 */
export function outcome(
  op: ReviewOperation,
  state: string,
  company: string,
): { says?: string; note?: string } {
  const result = op.result?.summary;
  if (state === "succeeded") {
    const who =
      op.approvedBy?.approver === "agent"
        ? "Approved by Iris on your standing instruction."
        : op.approvedBy
          ? "Approved by you."
          : "";
    return result && result !== NO_SUMMARY
      ? { says: result, ...(who ? { note: who } : {}) }
      : { note: [result, who].filter(Boolean).join(" ") };
  }
  if (state === "declined")
    return {
      note: `You declined this, and nothing was sent to ${company}. Ask for the change again if you still want it.`,
    };
  // A refusal, new terms or an ended conversation: the route's own sentence
  // says what happened. A proposal that ran out on its own clock has none,
  // or only one about an approval sent while it still waited.
  if (result && op.state !== "proposed") return { note: result };
  if (state !== "expired") return {};
  // That sentence says the terms still wait, so it isn't shown. The
  // approval it was about is part of what happened: these terms didn't run
  // out with nothing approved.
  const next = "Ask for the change again to get new terms.";
  return {
    note:
      op.notPerformed === "refused"
        ? `This proposal was approved, but ${company} refused the approval and did nothing. Its terms then ran out. ${next}`
        : op.notPerformed === "new_terms"
          ? `${company} returned these terms instead of performing the ones that were approved. These terms ran out before they were approved, so nothing was done. ${next}`
          : `This proposal ran out before it was approved, so nothing was done. ${next}`,
  };
}
