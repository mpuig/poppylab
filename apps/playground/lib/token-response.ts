import { validFdxId } from "@poppy-lab/pap-client";
import {
  ESPI_EXTENSION,
  type CompanyExtensions,
  type EspiExtensionEntry,
} from "@poppy-lab/pap-core";
import { grantedSubset } from "./account-permissions";

/**
 * `poppylab.dev/fdx` v1: the consent id a bank may add to a token response
 * (an extra field other agents ignore, RFC 6749 §5.1). Kept only when it
 * could be one path segment of the consent endpoint.
 */
const consentId = (value: unknown) => (validFdxId(value) ? value : undefined);
/**
 * `poppylab.dev/espi` v1: the subscription and authorization URIs a
 * utility adds (ESPI's `resourceURI`, `authorizationURI`), as short
 * strings. `keepTokenFields` checks them against the extension's entry.
 */
const uri = (value: unknown) =>
  typeof value === "string" && value.length <= 2048 ? value : undefined;

/** Validates an OAuth token response (RFC 6749 §5.1, §4.7). */
export function tokenResponse(
  result: Record<string, unknown>,
  requested: string,
  dpop: boolean,
  requireRefresh: boolean,
) {
  const scope =
    result.scope === undefined ? requested : (result.scope as unknown);
  if (
    typeof result.access_token !== "string" ||
    !result.access_token ||
    result.access_token.length > 4096 ||
    result.token_type !== (dpop ? "DPoP" : "Bearer") ||
    (result.expires_in !== undefined &&
      (typeof result.expires_in !== "number" ||
        !Number.isFinite(result.expires_in) ||
        result.expires_in <= 0)) ||
    (result.refresh_token !== undefined &&
      (typeof result.refresh_token !== "string" || !result.refresh_token)) ||
    (requireRefresh && result.refresh_token === undefined) ||
    !grantedSubset(scope, requested)
  )
    throw new Error("Invalid token response");
  return {
    accessToken: result.access_token,
    tokenType: (dpop ? "DPoP" : "Bearer") as "DPoP" | "Bearer",
    refreshToken: result.refresh_token as string | undefined,
    scope: scope as string,
    consentId: consentId(result.consent_id),
    resourceUri: uri(result.resourceURI),
    authorizationUri: uri(result.authorizationURI),
    expires:
      Date.now() + Math.min(Number(result.expires_in ?? 3600), 3600) * 1000,
  };
}

/**
 * `poppylab.dev/espi` v1: a URI from the token response, kept only when it
 * is exactly `{resource_endpoint}/{kind}/{id}`: the endpoint's origin, no
 * credentials, query or fragment, written as a URL parser writes it, and an
 * id that is one plain path segment (the adapter's id rule, no `%`).
 */
export function espiUri(
  entry: EspiExtensionEntry | undefined,
  value: string | undefined,
  kind: "Batch/Subscription" | "Authorization",
) {
  if (!entry || !value) return undefined;
  let url: URL, base: URL;
  try {
    url = new URL(value);
    base = new URL(entry.resource_endpoint);
  } catch {
    return undefined;
  }
  const prefix = `${base.pathname.replace(/\/+$/, "")}/${kind}/`;
  const id = url.pathname.startsWith(prefix)
    ? url.pathname.slice(prefix.length)
    : undefined;
  return url.href === value &&
    url.origin === base.origin &&
    !url.username &&
    !url.password &&
    // An empty query or fragment ("?", "#") stays in the href.
    !/[?#]/.test(value) &&
    validFdxId(id) &&
    !id.includes("%")
    ? value
    : undefined;
}

/** What a run keeps from its token responses for the domain extensions. */
type TokenFields = {
  fdxConsent?: string;
  espiResourceUri?: string;
  espiAuthorizationUri?: string;
  company?: { profile?: { extensions?: CompanyExtensions } };
};

/**
 * Keeps what a token response says for the domain extensions: the FDX
 * consent id and the ESPI subscription and authorization URIs. A sign-in
 * replaces them, dropping what it doesn't carry; a refresh keeps the ones
 * it doesn't repeat. A URI the ESPI entry doesn't fit is never kept.
 */
export function keepTokenFields(
  run: TokenFields,
  result: ReturnType<typeof tokenResponse>,
  signIn: boolean,
) {
  if (result.consentId) run.fdxConsent = result.consentId;
  else if (signIn) delete run.fdxConsent;
  const entry = run.company?.profile?.extensions?.[ESPI_EXTENSION];
  const resource = espiUri(entry, result.resourceUri, "Batch/Subscription");
  const authorization = espiUri(
    entry,
    result.authorizationUri,
    "Authorization",
  );
  if (resource) run.espiResourceUri = resource;
  else if (signIn) delete run.espiResourceUri;
  if (authorization) run.espiAuthorizationUri = authorization;
  else if (signIn) delete run.espiAuthorizationUri;
}
