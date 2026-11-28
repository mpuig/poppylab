/**
 * Whether a later sign-in at a Company is for the same account as the one
 * it replaces, from the Session the earlier one used (§5.4). The sign-in
 * callback asks it when no conversation with the Company's agent can say
 * (`sameOwner` in `sign-in-callback.ts`).
 */
import { protocolRequest } from "@poppy-lab/pap-client";
import { localOrigins, probeSession, type Connection } from "./runtime";

/**
 * The URL a Session check reads in an OpenAPI description: a GET with no
 * path or required parameter whose `x-poppy-scopes` the scopes cover, a
 * public one first, at the issuer's origin, where the Company's tokens
 * belong. It changes nothing, and nothing of the User's goes in it. Plain
 * data and no I/O.
 */
export function checkTarget(
  described: unknown,
  issuer: string,
  scopes: readonly string[],
  specUrl = issuer,
) {
  const origin = new URL(issuer).origin;
  const spec = described as {
    servers?: Array<{ url?: unknown }>;
    paths?: Record<string, Record<string, unknown>>;
  };
  const servers = spec?.servers;
  const server = Array.isArray(servers) ? servers[0]?.url : undefined;
  let resolved: URL;
  try {
    resolved =
      typeof server === "string" ? new URL(server, specUrl) : new URL(origin);
  } catch {
    return undefined;
  }
  if (
    resolved.origin !== origin ||
    resolved.username ||
    resolved.password ||
    resolved.search ||
    resolved.hash
  )
    return undefined;
  const base = resolved.href.replace(/\/$/, "");
  const reads = Object.entries(spec?.paths ?? {}).flatMap(([path, item]) => {
    const get = item?.get as
      | {
          parameters?: Array<{ required?: boolean }>;
          "x-poppy-scopes"?: unknown;
        }
      | undefined;
    if (!get || path.includes("{")) return [];
    if (get.parameters?.some((p) => p?.required)) return [];
    const needs = get["x-poppy-scopes"];
    if (!Array.isArray(needs) || !needs.every((s) => typeof s === "string"))
      return [];
    if (!needs.every((s) => scopes.includes(s))) return [];
    return [{ url: `${base}${path}`, public: needs.length === 0 }];
  });
  return (reads.find((r) => r.public) ?? reads[0])?.url;
}

/** `checkTarget` in the Company's own OpenAPI description, as discovery lists it. */
async function sessionCheckTarget(
  connection: Connection,
  scopes: readonly string[],
) {
  const company = connection.company;
  const api = company?.document.apis?.find((item) => item.type === "openapi");
  const issuer = company?.profile.issuer;
  if (!api || !issuer) return undefined;
  if (new URL(api.url).origin !== new URL(issuer).origin) return undefined;
  return checkTarget(
    await protocolRequest(api.url, {}, localOrigins),
    issuer,
    scopes,
    api.url,
  );
}

/**
 * §5.4: a Company may refuse an access token for another account than the
 * one its Session used, with `session_ended`. The lab's Companies all do,
 * in the gateway they share (`packages/pap-company/src/gateway/
 * sessions.ts`), and say nothing else about whose a token is. So a read
 * that changes nothing (`checkTarget`), sent in the Session the earlier
 * sign-in used, first with that sign-in's token, which ties the Session to
 * its account, then with the new one, shows whether the new sign-in is for
 * the same account: taken, it is; refused with `session_ended`, it is
 * another account's. Anything else says nothing, and neither does a
 * Company not known to refuse a second account (`enforces`), which may
 * take any token: `unknown`, never a proof. The connection's own token and
 * Session aren't changed, and no token is renewed for this.
 */
export async function sameBySession(
  connection: Connection,
  earlier: {
    sessionId: string | undefined;
    token: string | undefined;
    tokenType: "DPoP" | "Bearer" | undefined;
    tokenExpires: number | undefined;
    dpop: Connection["dpop"];
    scopes: string | undefined;
  },
  enforces: boolean,
): Promise<"same" | "other" | "unknown"> {
  if (
    !enforces ||
    !earlier.sessionId ||
    !earlier.token ||
    // Renewing an expired one would spend the earlier refresh token, which
    // is revoked right after.
    (earlier.tokenExpires ?? 0) < Date.now() + 10_000 ||
    !connection.token
  )
    return "unknown";
  try {
    const granted = (connection.scopes ?? "").split(" ");
    const scopes = (earlier.scopes ?? "")
      .split(" ")
      .filter((s) => s && granted.includes(s));
    const target = await sessionCheckTarget(connection, scopes);
    if (!target) return "unknown";
    // The Session the earlier sign-in used, on a copy of the connection.
    const inEarlier = { ...connection, sessionId: earlier.sessionId };
    const first = await probeSession(inEarlier, target, {
      value: earlier.token,
      type: earlier.tokenType ?? "DPoP",
      key: earlier.dpop,
    });
    if (first !== "accepted") return "unknown";
    const second = await probeSession(inEarlier, target, {
      value: connection.token,
      type: connection.tokenType ?? "DPoP",
      key: connection.dpop,
    });
    return second === "accepted"
      ? "same"
      : second === "session_ended"
        ? "other"
        : "unknown";
  } catch {
    return "unknown";
  }
}
