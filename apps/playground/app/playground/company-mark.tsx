import type { CSSProperties } from "react";
import type { CompanyRef } from "./companies";
import { brandOf } from "./company-state";

/**
 * A Company's mark: a small square in the leading colour of its own
 * website, as its card on the home is headed. A Company outside the lab
 * has no colour of the lab's, and is drawn as an outline. It names nothing
 * by itself: the Company's name is always beside it.
 */
export function CompanyMark({ origin }: { origin?: string | undefined }) {
  const brand = brandOf(origin);
  return (
    <span
      className={brand ? "company-mark" : "company-mark other"}
      style={brand ? ({ "--brand": brand } as CSSProperties) : undefined}
      aria-hidden="true"
    />
  );
}

/** The Company something came from, as a message or a line names it. */
export function FromCompany({ from }: { from: CompanyRef }) {
  return (
    <span className="from-company">
      <CompanyMark origin={from.origin} />
      {from.name}
    </span>
  );
}
