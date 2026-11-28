import {
  approvalHeader,
  assertion,
  configureRetryStore,
  discoverCompany,
  newSessionId,
  onWorkers,
  proof,
  protocolRequest,
  ProtocolError,
  vault,
  type Approval,
  type EspiRequestOptions,
  type FdxRequestOptions,
  type RetryState,
} from "@poppy-lab/pap-client";
import type { JWK } from "jose";
import { clientFor, identity } from "./agent-keys";
import { approveInConversation } from "./conversations";
import { localOrigins } from "./deployment";
import type { Connection, Operation } from "./run-types";
import { accountConfiguration, newSession, sessionHeaders } from "./session";
import { keepTokenFields, tokenResponse } from "./token-response";
import { UserFacingError } from "./user-error";

const globalState = globalThis as typeof globalThis & {
  papRetry?: ReturnType<typeof vault<RetryState>>;
};
// Retry-After cooldowns: durable in Node; per isolate in Workers.
if (!onWorkers() && process.env.NODE_ENV !== "test" && !process.env.VITEST)
  configureRetryStore(
    (globalState.papRetry ??= vault<RetryState>("retry-after", () => ({
      until: 0,
      entries: [],
    }))),
  );

/** The headers a DPoP nonce retry signs again: the Session JWT and its operator signature. */
const RESIGNED = [
  "Poppy-Session",
  "Signature",
  "Signature-Input",
  "Signature-Agent",
] as const;

/** The service a request URL belongs to: the conversation endpoint or the API base. */
function serviceFor(connection: Connection, url: string) {
  const endpoint = connection.conversation?.endpoint;
  const inside = (base: string) =>
    url === base ||
    url.startsWith(base.replace(/\/$/, "") + "/") ||
    url.startsWith(base + "?");
  if (endpoint && inside(endpoint)) return endpoint;
  if (connection.apiBase && inside(connection.apiBase))
    return connection.apiBase;
  return undefined;
}
const sameUrl = (a: string, b: string) => {
  try {
    const x = new URL(a),
      y = new URL(b);
    return (
      x.protocol === y.protocol &&
      x.host.toLowerCase() === y.host.toLowerCase() &&
      x.pathname.replace(/\/$/, "") === y.pathname.replace(/\/$/, "") &&
      !x.search &&
      !x.hash
    );
  } catch {
    return false;
  }
};

/**
 * §4.5: before the first signed-in call to a service, its protected resource
 * metadata (RFC 9728 §3.1), used only if its `resource` is the service URL.
 * A `resource` other than the domain's means the service takes only its own
 * tokens. Without usable metadata, the default token works there.
 */
async function serviceResource(connection: Connection, service: string) {
  const cached = connection.services?.[service];
  if (cached && cached.until > Date.now()) return cached.resource;
  const url = new URL(service);
  const path = url.pathname.replace(/\/$/, "");
  const metadata = `${url.origin}/.well-known/oauth-protected-resource${path}`;
  let resource: string | undefined;
  let ttl = 3600000;
  try {
    const value = (await protocolRequest(metadata, {}, localOrigins)) as {
      resource?: unknown;
    };
    if (typeof value?.resource === "string" && sameUrl(value.resource, service))
      resource = value.resource;
  } catch (error) {
    // A 404 means no metadata; other failures are retried sooner.
    if (!(error instanceof ProtocolError && error.status === 404)) ttl = 300000;
  }
  const services = (connection.services ??= {});
  for (const k of Object.keys(services).slice(0, -15)) delete services[k];
  services[service] = {
    ...(resource ? { resource } : {}),
    until: Date.now() + ttl,
  };
  return resource;
}

/**
 * §4.5: a token for one service's resource, from the refresh token (no new
 * sign-in), with the same DPoP key (§4.4). `invalid_target` means the
 * Company doesn't offer that service signed in.
 */
async function resourceToken(connection: Connection, resource: string) {
  const tokens = (connection.resourceTokens ??= {});
  const cached = tokens[resource];
  if (
    cached &&
    ("unavailable" in cached ? cached.until : cached.expires - 60000) >
      Date.now()
  )
    return cached;
  if (!connection.accountToken || !connection.scopes)
    throw new Error("Sign in required");
  const dpop = usesDpop(connection) ? connection.dpop : undefined;
  if (usesDpop(connection) && !dpop) throw new Error("Sign in required");
  try {
    const result = tokenResponse(
      await tokenRequest(
        connection,
        {
          grant_type: "refresh_token",
          refresh_token: connection.accountToken,
          resource,
        },
        dpop,
      ),
      connection.scopes,
      !!dpop,
      false,
    );
    if (result.refreshToken) connection.accountToken = result.refreshToken;
    return (tokens[resource] = {
      value: result.accessToken,
      type: result.tokenType,
      expires: result.expires,
    });
  } catch (error) {
    if (error instanceof ProtocolError && error.code === "invalid_target")
      return (tokens[resource] = {
        unavailable: true as const,
        until: Date.now() + 3600000,
      });
    throw error;
  }
}

function markAccountFailure(connection: Connection, error: unknown) {
  if (
    error instanceof ProtocolError &&
    error.status < 500 &&
    ["invalid_grant", "invalid_token"].includes(error.code ?? "")
  )
    connection.accountUnavailable = true;
}

/**
 * Sends one request to a Company API or protocol endpoint with the Session
 * header, `Poppy-Version` and, when signed in, the access token. Only
 * `session_ended` starts a new Session and resends, once (§5.5).
 * `invalid_session` isn't retried: a new Session would fail the same way.
 * `version_unsupported` stops: this client implements 1.0 only (§3.4).
 */
/**
 * One GET in the connection's Session as it is, with exactly this access
 * token: no renewal, no per-service token, and no new Session on
 * `session_ended`, which `papRequest` would start. For a check whose
 * answer is the Session's (§5.4), so its refusal is read, not retried.
 * `accepted` is a success; `session_ended` the Company refusing the token
 * in this Session; anything else, error or not, is `unknown`.
 */
export async function probeSession(
  connection: Connection,
  url: string,
  token: { value: string; type: "DPoP" | "Bearer"; key?: JWK | undefined },
): Promise<"accepted" | "session_ended" | "unknown"> {
  try {
    const headers = await sessionHeaders(connection, url, "GET", token);
    await protocolRequest(
      url,
      { method: "GET", headers },
      localOrigins,
      token.type === "DPoP"
        ? {
            key: token.key!,
            token: token.value,
            resign: async () => {
              const fresh = await sessionHeaders(connection, url, "GET", token);
              return Object.fromEntries(
                RESIGNED.flatMap((k) => (fresh[k] ? [[k, fresh[k]]] : [])),
              );
            },
          }
        : undefined,
    );
    return "accepted";
  } catch (error) {
    return error instanceof ProtocolError &&
      error.status === 400 &&
      error.code === "session_ended"
      ? "session_ended"
      : "unknown";
  }
}

export async function papRequest(
  connection: Connection,
  url: string,
  /**
   * PUT only for `poppylab.dev/fdx` consent revocation and DELETE only for
   * `poppylab.dev/espi` authorization revocation: the User's actions.
   */
  method: "GET" | "POST" | "PUT" | "DELETE",
  body?: unknown,
  options: {
    signedOut?: boolean;
    approval?: Approval;
    /** A success without a body (202 or 204) resolves to null. */
    acceptEmpty?: boolean;
    /**
     * An error that is no Poppy or OAuth error keeps its body (as
     * `ProtocolError.body`), for an API with error bodies of its own.
     */
    errorBody?: boolean;
    /**
     * A success is a document of this type, read as a `BinaryBody` of at
     * most `maxBytes` (a statement PDF, an ESPI-shaped Atom feed). Sent as
     * the request's Accept.
     */
    binary?: FdxRequestOptions | EspiRequestOptions;
  } = {},
) {
  if (connection.accountToken && !options.signedOut)
    await renewIfNeeded(connection);
  let token =
    connection.token && !options.signedOut && !connection.accountUnavailable
      ? {
          value: connection.token,
          type: connection.tokenType ?? ("DPoP" as "DPoP" | "Bearer"),
          key: connection.dpop,
        }
      : undefined;
  // §4.5: a service with its own resource gets its own token.
  const service = token ? serviceFor(connection, url) : undefined;
  const resource = service
    ? await serviceResource(connection, service)
    : undefined;
  if (
    token &&
    resource &&
    !sameUrl(resource, new URL(connection.company!.discoveryUrl).origin)
  ) {
    const own = await resourceToken(connection, resource);
    token =
      "unavailable" in own
        ? undefined
        : { value: own.value, type: own.type, key: connection.dpop };
  }
  const send = async () => {
    const headers = {
      ...(await sessionHeaders(connection, url, method, token)),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.binary ? { Accept: options.binary.accept } : {}),
      ...(options.approval
        ? { "Poppy-Approval": approvalHeader(options.approval) }
        : {}),
    };
    return protocolRequest(
      url,
      {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      localOrigins,
      token?.type === "DPoP"
        ? {
            key: token.key!,
            token: token.value,
            resign: async () => {
              const fresh = await sessionHeaders(
                connection,
                url,
                method,
                token,
              );
              return Object.fromEntries(
                RESIGNED.flatMap((k) => (fresh[k] ? [[k, fresh[k]]] : [])),
              );
            },
          }
        : undefined,
      options.acceptEmpty || options.errorBody || options.binary
        ? {
            ...(options.acceptEmpty ? { acceptEmpty: true } : {}),
            ...(options.errorBody ? { errorBody: true } : {}),
            ...(options.binary
              ? { binary: { maxBytes: options.binary.maxBytes } }
              : {}),
          }
        : undefined,
    );
  };
  try {
    try {
      return await send();
    } catch (error) {
      if (
        error instanceof ProtocolError &&
        error.status === 400 &&
        error.code === "session_ended"
      ) {
        newSession(connection);
        return await send();
      }
      throw error;
    }
  } catch (error) {
    if (
      error instanceof ProtocolError &&
      error.status === 400 &&
      error.code === "version_unsupported"
    ) {
      // §3.4: fetch poppy.json again, without a cached copy, and choose
      // again. Another version: a new Session and the request once more.
      // The same one: stop sending it.
      const before = connection.company!.profile.version;
      const fresh = await discoverCompany(connection.url, {
        allowedPrivateOrigins: localOrigins,
      });
      if (fresh.profile.version !== before) {
        connection.company = fresh;
        newSession(connection);
        try {
          return await send();
        } catch (again) {
          markAccountFailure(connection, again);
          throw again;
        }
      }
      throw new UserFacingError(
        "This Company no longer serves a protocol version Poppy Lab implements (1.x). The request wasn't sent again.",
      );
    }
    markAccountFailure(connection, error);
    throw error;
  }
}

async function tokenRequest(
  connection: Connection,
  params: Record<string, string>,
  dpop?: JWK,
) {
  const config = accountConfiguration(connection);
  const keys = await identity();
  const client = clientFor(connection);
  const endpoint = config.token_endpoint;
  const body = new URLSearchParams({
    ...params,
    client_id: client,
    client_assertion_type:
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: await assertion(
      keys.privateKey,
      client,
      client,
      config.issuer,
    ),
  });
  return (await protocolRequest(
    endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(dpop ? { DPoP: await proof(dpop, endpoint, "POST") } : {}),
      },
      body: body.toString(),
    },
    localOrigins,
    dpop
      ? {
          key: dpop,
          assertions: { key: keys.privateKey, client, issuer: config.issuer },
        }
      : undefined,
  )) as Record<string, unknown>;
}

/**
 * RFC 9126 (§4.2): pushes the authorization request with the client
 * assertion, and a DPoP proof when tokens are DPoP-bound, so the Company can
 * bind the code to that key. Returns the `request_uri` to open.
 */
export async function pushAuthorizationRequest(
  connection: Connection,
  params: Record<string, string>,
  dpop?: JWK,
) {
  const config = accountConfiguration(connection);
  const endpoint = config.pushed_authorization_request_endpoint!;
  const keys = await identity();
  const client = clientFor(connection);
  const result = (await protocolRequest(
    endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(dpop ? { DPoP: await proof(dpop, endpoint, "POST") } : {}),
      },
      body: new URLSearchParams({
        ...params,
        client_assertion_type:
          "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: await assertion(
          keys.privateKey,
          client,
          client,
          config.issuer,
        ),
      }).toString(),
    },
    localOrigins,
    dpop
      ? {
          key: dpop,
          assertions: { key: keys.privateKey, client, issuer: config.issuer },
        }
      : undefined,
  )) as { request_uri?: unknown };
  if (
    typeof result?.request_uri !== "string" ||
    result.request_uri.length > 512 ||
    // RFC 9126 §2.2: its format is the server's choice; a printable URI.
    !/^[A-Za-z][A-Za-z0-9+.-]*:[\x21-\x7e]+$/.test(result.request_uri)
  )
    throw new Error("Invalid pushed authorization response");
  return result.request_uri;
}

/** Whether the issuer binds access tokens with DPoP (RFC 9449 §5.1). */
export const usesDpop = (connection: Connection) =>
  !!connection.company?.metadata?.dpop_signing_alg_values_supported?.includes(
    "ES256",
  );

async function renewIfNeeded(connection: Connection) {
  if (
    connection.accountToken &&
    (!connection.token || (connection.tokenExpires ?? 0) < Date.now() + 60000)
  )
    await renewAccount(connection);
}

/**
 * refresh_token grant (§4.4) within the current scopes. A refresh that
 * omits refresh_token keeps the existing one. No Session is involved.
 */
export async function renewAccount(connection: Connection) {
  if (!connection.accountToken || !connection.scopes)
    throw new Error("Sign in required");
  // §4.4: refresh with the DPoP key the refresh token was issued with.
  if (usesDpop(connection) && !connection.dpop)
    throw new Error("Sign in required");
  const dpop = usesDpop(connection) ? connection.dpop : undefined;
  const scopes = connection.scopes;
  const refreshToken = connection.accountToken;
  let result;
  try {
    result = tokenResponse(
      await tokenRequest(
        connection,
        {
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          scope: scopes,
        },
        dpop,
      ),
      scopes,
      !!dpop,
      false,
    );
  } catch (error) {
    markAccountFailure(connection, error);
    throw error instanceof ProtocolError
      ? error
      : new Error("Invalid account renewal");
  }
  delete connection.accountUnavailable;
  connection.token = result.accessToken;
  connection.tokenType = result.tokenType;
  connection.accountToken = result.refreshToken ?? refreshToken;
  connection.scopes = result.scope;
  connection.tokenExpires = result.expires;
  // poppylab.dev/fdx v1: the grant's consent id comes again on refresh, and
  // poppylab.dev/espi v1: its subscription and authorization URIs.
  keepTokenFields(connection, result, false);
}

/**
 * Operations v3 §6: this revision's approval, as first sent. `user`: the
 * User clicked Approve (`tap`). `agent`: Iris approved on a standing
 * instruction the User wrote, with no `input_type`. The reference names
 * this playground's ledger entry, never shared across Companies. A retry
 * sends the very same approval (§7); a different approver is a new one.
 */
export function approvalFor(
  op: Operation,
  approver: "user" | "agent" = "user",
  /**
   * How the User gave their answer (Operations v3 §6): `tap` for a button,
   * `typed` for their own words in the chat. Kept with the approval, so a
   * retry says the same.
   */
  input: "tap" | "typed" = "tap",
): Approval {
  if (!op.approval || (op.approval.approver ?? "user") !== approver)
    op.approval = {
      approver,
      approved_at: Math.floor(Date.now() / 1000),
      reference: `apr_${newSessionId().slice(0, 24)}`,
      ...(approver === "user" && input !== "tap" ? { input_type: input } : {}),
    };
  return {
    operation_id: op.operation_id,
    revision: op.revision,
    approver,
    approved_at: op.approval.approved_at,
    ...(approver === "user"
      ? { input_type: op.approval.input_type ?? "tap" }
      : {}),
    reference: op.approval.reference,
  };
}
/** The User's own approval (kept for callers that only ever send that). */
export const userApproval = (op: Operation) => approvalFor(op, "user");

/**
 * Operations v3 §6: resends the exact request with the User's approval in
 * Poppy-Approval, or sends it in a message of the operation's conversation.
 */
export async function sendApproval(
  connection: Connection,
  op: Operation,
  approver: "user" | "agent" = "user",
  input: "tap" | "typed" = "tap",
) {
  const approval = approvalFor(op, approver, input);
  if (op.request?.conversation)
    return approveInConversation(
      connection,
      op,
      approval,
      (c, url, method, body) => papRequest(c, url, method, body),
    );
  if (!op.request) throw new Error("Operation request unavailable");
  // As for the request itself: a refusal's own body is kept on the error,
  // so the card can show a number from it (never its words).
  return papRequest(connection, op.request.url, "POST", op.request.body, {
    approval,
    errorBody: true,
  });
}

/** RFC 7009 revocation of one refresh token (§4.6). */
export async function revokeRefreshToken(
  connection: Connection,
  token: string,
) {
  const config = accountConfiguration(connection);
  const client = clientFor(connection);
  const keys = await identity();
  await protocolRequest(
    config.revocation_endpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token,
        token_type_hint: "refresh_token",
        client_id: client,
        client_assertion_type:
          "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: await assertion(
          keys.privateKey,
          client,
          client,
          config.issuer,
        ),
      }).toString(),
    },
    localOrigins,
    undefined,
    { acceptEmpty: true },
  );
}
