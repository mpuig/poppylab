/**
 * Where this Poppy runs and what it may do. Local development keeps the old
 * behaviour; a public deployment (`POPPY_PUBLIC=true`, HTTPS
 * `AGENT_PUBLIC_ORIGIN`) serves anyone who brings their own model key, with
 * per-visitor state and rate limits.
 */
import { isLocalCompany, LOCAL_COMPANY_ORIGINS } from "@poppy-lab/pap-core";
import { isSandbox } from "./company-policy";

export const localOrigins: string[] =
  process.env.NODE_ENV === "development" &&
  process.env.PAP_ALLOW_PRIVATE_NETWORK === "true"
    ? [...LOCAL_COMPANY_ORIGINS]
    : [];

/** Public mode needs an HTTPS identity; it never trusts a plain-HTTP one. */
export const publicMode = () =>
  process.env.POPPY_PUBLIC === "true" &&
  (process.env.AGENT_PUBLIC_ORIGIN ?? "").startsWith("https://");
export const serving = () =>
  process.env.NODE_ENV === "development" || publicMode();

/** Exact HTTPS origins of test Companies trusted for sign-in and proposals. */
export function accountOrigins(): string[] {
  return (process.env.PAP_ACCOUNT_ORIGINS ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .filter((o) => {
      try {
        const u = new URL(o);
        return u.protocol === "https:" && u.origin === o;
      } catch {
        return false;
      }
    });
}
/** Companies this Poppy may sign in to. */
export const isAccountCompany = (origin: string) =>
  isSandbox(origin) ||
  (isLocalCompany(origin) && localOrigins.includes(origin)) ||
  accountOrigins().includes(origin);
/** Companies whose proposals may become approval cards (still Operations v2 only). */
export const proposalsAllowed = (origin: string) =>
  isSandbox(origin) ||
  (isLocalCompany(origin) && localOrigins.includes(origin)) ||
  accountOrigins().includes(origin);
