import type { CompanyProfile } from "@poppy-lab/pap-core";

/** Scopes the Company marks as changing nothing (0.3 §4.7 hints). */
export const readOnlyScopes = (profile: CompanyProfile) =>
  profile.scopes.filter((s) => profile.scopeHints[s]?.changes === "none");

/**
 * Least privilege from the Company's own scopes and hints (RFC 9700 §2.3):
 * "read" asks only for scopes hinted as changing nothing; "write" asks for
 * every advertised scope. Scopes without hints are never treated as read-only.
 */
export function consentScopes(
  profile: CompanyProfile,
  access: unknown = "read",
) {
  if (access !== "read" && access !== "write")
    throw Error("Unsupported permission request");
  if (!profile.signIn.direct)
    throw Error("The Company offers no Direct Sign-In");
  const scopes = access === "read" ? readOnlyScopes(profile) : profile.scopes;
  if (
    access === "write" &&
    scopes.every((s) => profile.scopeHints[s]?.changes === "none")
  )
    throw Error("The Company advertises no scopes for changes");
  if (!scopes.length || scopes.length > 32)
    throw Error(
      access === "read"
        ? "The Company marks no scope as read-only"
        : "The Company advertises no scopes",
    );
  return scopes.join(" ");
}

/** Whether the grant includes a scope that can change something. */
export function canChange(
  profile: CompanyProfile | undefined,
  granted: string,
) {
  if (!profile) return false;
  return granted
    .split(" ")
    .some((s) => s && profile.scopeHints[s]?.changes !== "none");
}
/** Whether a scope beyond the granted ones could be requested for changes. */
export function canRequestChanges(
  profile: CompanyProfile | undefined,
  granted: string,
) {
  if (!profile?.signIn.direct) return false;
  const have = granted.split(" ");
  return profile.scopes.some(
    (s) => !have.includes(s) && profile.scopeHints[s]?.changes !== "none",
  );
}

export function consentOutcome(
  data: { signedIn: boolean; authPending: boolean; consentVersion: number },
  baseline: number,
) {
  if (data.authPending) return "pending";
  return data.signedIn && data.consentVersion > baseline
    ? "completed"
    : "not_completed";
}
export function grantedSubset(granted: unknown, requested: string) {
  if (typeof granted !== "string" || !granted) return false;
  const values = granted.split(" ");
  return (
    new Set(values).size === values.length &&
    values.every((s) => requested.split(" ").includes(s))
  );
}
