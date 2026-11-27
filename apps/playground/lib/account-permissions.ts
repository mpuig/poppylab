import { BROWSER_SIGN_IN, type CompanyProfile } from "@poppy-lab/pap-core";
import {
  asksFor,
  DOMAIN_EXTENSIONS,
  extensionOfScope,
  type DomainExtension,
} from "./domain-extension";

/** Scopes the Company marks as changing nothing (§4.7 hints). */
export const readOnlyScopes = (profile: CompanyProfile) =>
  profile.scopes.filter((s) => profile.scopeHints[s]?.changes === "none");

/**
 * The scopes of a domain extension that a sign-in with it on asks for (the
 * read-only ones the Company advertises) and that a grant lacks: with the
 * extension on, these need a new sign-in.
 */
export function missingExtensionScopes(
  profile: CompanyProfile | undefined,
  granted: string,
  extension: DomainExtension,
) {
  if (!profile) return [];
  const have = granted.split(" ");
  return readOnlyScopes(profile).filter(
    (s) => asksFor(extension, s) && !have.includes(s),
  );
}
/** Use FDX: the FDX-shaped data clusters a grant lacks. */
export const missingFdxScopes = (
  profile: CompanyProfile | undefined,
  granted: string,
) => missingExtensionScopes(profile, granted, DOMAIN_EXTENSIONS[0]!);

/**
 * Least privilege from the Company's own scopes and hints (RFC 9700 §2.3):
 * "read" asks only for scopes hinted as changing nothing; "write" asks for
 * every advertised scope. Scopes without hints are never treated as read-only.
 * A domain extension's scopes (the FDX-shaped data clusters, the ESPI-shaped
 * scopes its tools use) are asked for only with Use FDX or Use ESPI on, when
 * the tools that use them exist; never otherwise, whatever their hints.
 * `poppy:browser-sign-in` signs an agent's browser in on the Company's
 * website (§6). Iris has no browser, so it never asks for it.
 */
export function consentScopes(
  profile: CompanyProfile,
  access: unknown = "read",
  options: Partial<Record<DomainExtension["key"], boolean>> = {},
) {
  if (access !== "read" && access !== "write")
    throw Error("Unsupported permission request");
  if (!profile.signIn.direct)
    throw Error("The Company offers no Direct Sign-In");
  const scopes = (
    access === "read" ? readOnlyScopes(profile) : profile.scopes
  ).filter((s) => {
    if (s === BROWSER_SIGN_IN) return false;
    const extension = extensionOfScope(s);
    return !extension || (!!options[extension.key] && asksFor(extension, s));
  });
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
    (s) =>
      // Never asked for (`consentScopes`), so never left to ask for.
      s !== BROWSER_SIGN_IN &&
      !have.includes(s) &&
      profile.scopeHints[s]?.changes !== "none",
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

/**
 * What the model is told of the User's account at the turn's Company, every
 * turn. Without it, a model read Company content such as "opening a case
 * needs the customer signed in" as saying the User wasn't, and asked a
 * signed-in User to sign in.
 */
export function accountNote(
  company: string,
  account: {
    /** Iris holds a sign-in, whether or not the Company still takes it. */
    signedIn: boolean;
    /** The Company no longer takes it. */
    lost: boolean;
    granted: string;
    profile: CompanyProfile | undefined;
  },
) {
  if (account.signedIn && account.lost)
    return `Account note: ${company} no longer accepts the user's sign-in. Requests that need the account fail until the user signs in again with the Sign in control in the chat.`;
  if (!account.signedIn)
    return `Account note: the user is not signed in at ${company}. A request that needs the account answers sign_in_required; then ask the user to use the Sign in control in the chat.`;
  const granted = account.granted.split(" ").filter(Boolean);
  const changes = canChange(account.profile, account.granted)
    ? "They include proposing changes."
    : canRequestChanges(account.profile, account.granted)
      ? "They don't include proposing changes: when a request needs that, tell the user this permission is missing and that they can choose Request change permission in the chat."
      : "They don't include proposing changes, and this Company offers no permission for that.";
  return `Account note: the user is signed in at ${company}${granted.length ? `, with these permissions: ${granted.join(", ")}` : ""}. Never ask them to sign in. ${changes}`;
}
