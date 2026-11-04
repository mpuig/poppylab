export type ReviewOperation = {
  operation_id: string;
  revision: string;
  state: string;
  summary: string;
  terms?: Record<string, unknown>;
  expires_at: string;
  result?: { summary: string } | null;
};
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
        : typeof t.refund_cents === "number"
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
