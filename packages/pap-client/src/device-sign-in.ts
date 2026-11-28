/**
 * Device Sign-In (§4.3, RFC 8628) for a Personal Agent: it asks the
 * Company for a code, checks where the code's link leads, and polls the
 * token endpoint until the User answers on the Company's page.
 *
 * What the User sees (`DeviceSignInPrompt`) never holds the `device_code`:
 * whoever has it gets the tokens. It stays in `DeviceSignInPending`, which
 * the Personal Agent keeps in its own store, never where the User, a model
 * or a browser can read it.
 */
import ipaddr from "ipaddr.js";
import type { JWK } from "jose";
import type { DiscoveredCompany } from "@poppy-lab/pap-core";
import { protocolRequest } from "./index.ts";
import { ProtocolError } from "./protocol-error.ts";
import { assertion, proof } from "./session.ts";

export const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

/** The Personal Agent as it signs in: its `client_id` and keys. */
export type DeviceClient = {
  clientId: string;
  /** The key from `jwks_uri` that signs client assertions (§4.1). */
  key: JWK;
  /** The DPoP key for this User (§4.5), sent with every request when given. */
  dpop?: JWK;
  /** Plain-HTTP origins allowed in development, such as a local Company. */
  allowedPrivateOrigins?: readonly string[];
};

/**
 * What the Personal Agent shows the User (§4.3): the Company's name and
 * domain with the link and the code. `verificationUriComplete` carries the
 * code, for a link or a QR code.
 */
export type DeviceSignInPrompt = {
  company: string;
  domain: string;
  verificationUri: string;
  verificationUriComplete?: string;
  userCode: string;
  /** When the code ends, in milliseconds since the epoch. */
  expiresAt: number;
};

/**
 * What the Personal Agent keeps to poll. `deviceCode` is secret: keep it in
 * the agent's own store, and never show or log it.
 */
export type DeviceSignInPending = {
  issuer: string;
  tokenEndpoint: string;
  scope: string;
  deviceCode: string;
  /** Seconds between polls; `slow_down` adds 5 (RFC 8628 §3.5). */
  interval: number;
  expiresAt: number;
  /** The earliest time for the next poll. */
  nextPollAt: number;
};

/** The token response of an approved sign-in (§4.7). */
export type DeviceSignInTokens = {
  accessToken: string;
  tokenType: string;
  expiresIn?: number;
  refreshToken: string;
  /** What was granted: the response's `scope`, or all that was asked. */
  scope: string;
};

export type DevicePoll =
  | { status: "pending"; pending: DeviceSignInPending }
  | { status: "approved"; tokens: DeviceSignInTokens }
  | { status: "declined" }
  | { status: "expired" };

/**
 * §4.3: whether a sign-in link may be shown for this Company. Its host must
 * be the issuer's or `organization.domain`'s, or a subdomain of either, on
 * the same port; otherwise a Company could pass off another Company's page
 * as its own. HTTPS only, except an allowed development origin.
 */
export function deviceLinkAllowed(
  link: string,
  issuer: string,
  domain: string,
  allowedPrivateOrigins: readonly string[] = [],
) {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && allowedPrivateOrigins.includes(url.origin))
  )
    return false;
  const bases: URL[] = [];
  for (const base of [issuer, `https://${domain}`])
    try {
      bases.push(new URL(base));
    } catch {
      /* Not a host: it allows nothing. */
    }
  return bases.some(
    (base) =>
      url.port === base.port &&
      (url.hostname === base.hostname ||
        // An address has no subdomains.
        (!ipaddr.isValid(base.hostname.replace(/^\[|\]$/g, "")) &&
          url.hostname.endsWith(`.${base.hostname}`))),
  );
}

const form = async (
  endpoint: string,
  issuer: string,
  client: DeviceClient,
  params: Record<string, string>,
) =>
  protocolRequest(
    endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(client.dpop
          ? { DPoP: await proof(client.dpop, endpoint, "POST") }
          : {}),
      },
      // §4.3: every request carries a fresh client assertion.
      body: new URLSearchParams({
        ...params,
        client_id: client.clientId,
        client_assertion_type:
          "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: await assertion(
          client.key,
          client.clientId,
          client.clientId,
          issuer,
        ),
      }).toString(),
    },
    client.allowedPrivateOrigins ?? [],
    client.dpop
      ? {
          key: client.dpop,
          assertions: { key: client.key, client: client.clientId, issuer },
        }
      : undefined,
  ) as Promise<Record<string, unknown>>;

const text = (value: unknown, max: number) =>
  typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : undefined;

/**
 * Asks the Company for a code with the scopes the task needs (§4.7). It
 * throws when the Company doesn't offer Device Sign-In, or when the link it
 * returns may not be shown (§4.3); nothing is then shown to the User.
 */
export async function startDeviceSignIn(
  company: DiscoveredCompany,
  scope: string,
  client: DeviceClient,
  now = Date.now(),
): Promise<{ prompt: DeviceSignInPrompt; pending: DeviceSignInPending }> {
  const { profile, metadata, document } = company;
  const issuer = profile.issuer;
  const endpoint = metadata?.device_authorization_endpoint;
  if (!profile.signIn.device || !issuer || !endpoint || !metadata)
    throw new Error("This Company doesn't offer Device Sign-In");
  if (!scope.trim()) throw new Error("Device Sign-In needs at least one scope");
  const body = await form(endpoint, issuer, client, { scope });
  const deviceCode = text(body.device_code, 1024),
    userCode = text(body.user_code, 64),
    verificationUri = text(body.verification_uri, 2048),
    complete =
      body.verification_uri_complete === undefined
        ? undefined
        : text(body.verification_uri_complete, 2048);
  const expiresIn = body.expires_in,
    interval = body.interval ?? 5;
  if (
    !deviceCode ||
    !userCode ||
    !/^[\x21-\x7e]+(?: [\x21-\x7e]+)*$/.test(userCode) ||
    !verificationUri ||
    (body.verification_uri_complete !== undefined && !complete) ||
    typeof expiresIn !== "number" ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0 ||
    typeof interval !== "number" ||
    !Number.isFinite(interval) ||
    interval <= 0
  )
    throw new Error("The Company's device authorization response is invalid");
  const domain = document.organization.domain;
  for (const link of [verificationUri, ...(complete ? [complete] : [])])
    if (!deviceLinkAllowed(link, issuer, domain, client.allowedPrivateOrigins))
      throw new Error(
        `The sign-in link isn't on ${new URL(issuer).host} or ${domain}, so it isn't shown`,
      );
  // At most half an hour, whatever the Company says, so polling ends.
  const expiresAt = now + Math.min(expiresIn, 1800) * 1000;
  const seconds = Math.min(Math.ceil(interval), 60);
  return {
    prompt: {
      company: document.organization.name,
      domain,
      verificationUri,
      ...(complete ? { verificationUriComplete: complete } : {}),
      userCode,
      expiresAt,
    },
    pending: {
      issuer,
      tokenEndpoint: metadata.token_endpoint,
      scope,
      deviceCode,
      interval: seconds,
      expiresAt,
      nextPollAt: now + seconds * 1000,
    },
  };
}

/**
 * One poll of the token endpoint (RFC 8628 §3.4). A pending result carries
 * the request as it now stands, with a longer interval after `slow_down`.
 * Other errors are thrown, as `ProtocolError`.
 */
export async function pollDeviceSignIn(
  pending: DeviceSignInPending,
  client: DeviceClient,
  now = Date.now(),
): Promise<DevicePoll> {
  if (now >= pending.expiresAt) return { status: "expired" };
  let body: Record<string, unknown>;
  try {
    body = await form(pending.tokenEndpoint, pending.issuer, client, {
      grant_type: DEVICE_GRANT,
      device_code: pending.deviceCode,
    });
  } catch (e) {
    if (!(e instanceof ProtocolError)) throw e;
    if (e.code === "authorization_pending" || e.code === "slow_down") {
      const interval = pending.interval + (e.code === "slow_down" ? 5 : 0);
      return {
        status: "pending",
        pending: { ...pending, interval, nextPollAt: now + interval * 1000 },
      };
    }
    if (e.code === "access_denied") return { status: "declined" };
    if (e.code === "expired_token") return { status: "expired" };
    throw e;
  }
  const accessToken = text(body.access_token, 4096),
    tokenType = text(body.token_type, 64),
    refreshToken = text(body.refresh_token, 4096);
  // §4.4: sign-in returns a refresh token.
  if (!accessToken || !tokenType || !refreshToken)
    throw new Error("The Company's token response is invalid");
  return {
    status: "approved",
    tokens: {
      accessToken,
      tokenType,
      ...(typeof body.expires_in === "number"
        ? { expiresIn: body.expires_in }
        : {}),
      refreshToken,
      // §4.7: no `scope` means every scope asked for was granted.
      scope: text(body.scope, 4096) ?? pending.scope,
    },
  };
}

/**
 * Polls until the User approves or declines, or the code ends, waiting the
 * interval between polls. `signal` stops it.
 */
export async function waitForDeviceSignIn(
  pending: DeviceSignInPending,
  client: DeviceClient,
  options: { signal?: AbortSignal } = {},
): Promise<Exclude<DevicePoll, { status: "pending" }>> {
  const signal = options.signal;
  let current = pending;
  for (;;) {
    signal?.throwIfAborted();
    const wait = current.nextPollAt - Date.now();
    if (wait > 0)
      await new Promise<void>((done, fail) => {
        const onAbort = () => {
          clearTimeout(timer);
          fail(signal!.reason);
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          done();
        }, wait);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    signal?.throwIfAborted();
    const result = await pollDeviceSignIn(current, client);
    if (result.status !== "pending") return result;
    current = result.pending;
  }
}
