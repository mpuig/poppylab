import {
  ProtocolError,
  errorCode,
  checkCooldown,
  recordCooldown,
} from "./protocol-error.ts";
export {
  ProtocolError,
  approvalHeader,
  parseApprovalHeader,
  configureRetryStore,
  type RetryState,
} from "./protocol-error.ts";
export { vault } from "./vault.ts";
export { openApiTools, type ApiTool } from "./openapi.ts";
import { sseRpc } from "./mcp-wire.ts";
export { mcpTools, mcpResourcePolicy } from "./mcp.ts";
import { proof, assertion } from "./session.ts";
import type { JWK } from "jose";
import ipaddr from "ipaddr.js";
import {
  authorizationServerMetadataSchema,
  normalizeScopeHints,
  PapDiscoveryError,
  poppyDocument03Schema,
  protectedResourceMetadataSchema,
  type AuthorizationServerMetadata,
  type CompanyProfile,
  parseExcludedTasks,
  type PoppyDocument03,
  type DiscoveredCompany,
  type DiscoveryTraceStep,
} from "@poppy-lab/pap-core";

const MAX_DOCUMENT_BYTES = 512_000;
const MAX_REDIRECTS = 3;

export interface DiscoveryOptions {
  allowedPrivateOrigins?: readonly string[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function metadataUrlForIssuer(issuer: string): URL {
  const url = new URL(issuer);
  const issuerPath = url.pathname === "/" ? "" : url.pathname;
  url.pathname = `/.well-known/oauth-authorization-server${issuerPath}`;
  url.search = "";
  url.hash = "";
  return url;
}

export function isPrivateAddress(address: string): boolean {
  // process() normalizes IPv4-mapped IPv6 before applying the range policy.
  return ipaddr.process(address).range() !== "unicast";
}

/**
 * Cloudflare Workers have no DNS API or socket pinning, and their `fetch`
 * can't reach private networks. There, only public HTTPS hostnames and
 * public IP literals are allowed; Node pins checked DNS answers instead.
 */
export const onWorkers = () =>
  typeof navigator !== "undefined" &&
  navigator.userAgent === "Cloudflare-Workers";
const localName = (hostname: string) =>
  /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/i.test(hostname) ||
  !hostname.includes(".");
function assertPublicHttpsHost(url: URL) {
  if (url.protocol !== "https:")
    throw new Error("PAP discovery requires HTTPS");
  if (url.username || url.password)
    throw new Error("URLs with credentials are not allowed");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    localName(hostname) ||
    (ipaddr.isValid(hostname) && isPrivateAddress(hostname))
  )
    throw new Error(
      "Private, loopback, and link-local destinations are blocked",
    );
}

async function assertPublicHttps(
  url: URL,
  allowedPrivateOrigins: readonly string[],
  signal: AbortSignal,
) {
  const allowPrivateNetwork = allowedPrivateOrigins.includes(url.origin);
  if (
    url.protocol !== "https:" &&
    !(allowPrivateNetwork && url.protocol === "http:")
  ) {
    throw new Error("PAP discovery requires HTTPS");
  }
  if (url.username || url.password)
    throw new Error("URLs with credentials are not allowed");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const { lookup } = await import("node:dns/promises");
  const addresses = await new Promise<
    Array<{ address: string; family: number }>
  >((resolve, reject) => {
    const abort = () => reject(new Error("Discovery timed out"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    lookup(hostname, { all: true, verbatim: true })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
  if (!Array.isArray(addresses)) throw new Error("DNS resolution failed");
  if (
    !addresses.length ||
    (!allowPrivateNetwork &&
      addresses.some(({ address }) => isPrivateAddress(address)))
  ) {
    throw new Error(
      "Private, loopback, and link-local destinations are blocked",
    );
  }
  return addresses;
}

/** Node: pin the checked DNS answers to the connection (no DNS rebinding). */
async function pinnedRequest(
  url: URL,
  init: RequestInit,
  addresses: Array<{ address: string; family: number }>,
) {
  const { Agent, fetch: pinnedFetch } = await import("undici");
  const agent = new Agent({
    connect: {
      lookup: (_hostname, lookupOptions, callback) => {
        const selected = addresses[0]!;
        if (lookupOptions.all) callback(null, addresses);
        else callback(null, selected.address, selected.family);
      },
    },
  });
  const response = (await pinnedFetch(url, {
    ...init,
    dispatcher: agent,
  } as Parameters<typeof pinnedFetch>[1])) as unknown as Response;
  return { response, close: () => agent.destroy() };
}

async function fetchJsonSafely(
  initialUrl: URL,
  options: Required<
    Pick<DiscoveryOptions, "allowedPrivateOrigins" | "fetchImpl" | "timeoutMs">
  > & {
    request?: RequestInit;
    protocol?: boolean;
    mcp?: boolean;
    acceptEmpty?: boolean;
  },
): Promise<{ value: unknown; finalUrl: URL; durationMs: number }> {
  let currentUrl = initialUrl;
  const started = performance.now();
  const signal = AbortSignal.timeout(options.timeoutMs);

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    checkCooldown(currentUrl.origin);
    const workers = onWorkers() && options.fetchImpl === fetch;
    let addresses: Array<{ address: string; family: number }> = [];
    if (workers) assertPublicHttpsHost(currentUrl);
    else
      addresses = await assertPublicHttps(
        currentUrl,
        options.allowedPrivateOrigins,
        signal,
      );
    let response: Response;
    let close = async () => {};
    try {
      const init = {
        ...options.request,
        redirect: "manual" as const,
        signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "Poppy-Lab/0.1",
          ...Object.fromEntries(
            new Headers(options.request?.headers).entries(),
          ),
        },
      };
      response =
        options.fetchImpl !== fetch || workers
          ? await options.fetchImpl(currentUrl, init)
          : await pinnedRequest(currentUrl, init, addresses).then((r) => {
              close = r.close;
              return r.response;
            });

      const retryAt = !response.ok
        ? recordCooldown(currentUrl.origin, response.headers.get("retry-after"))
        : undefined;
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
      } else {
        if (options.mcp && response.ok && response.status === 202) {
          await response.body?.cancel();
          return {
            value: {
              message: null,
              sessionId: response.headers.get("mcp-session-id"),
            },
            finalUrl: currentUrl,
            durationMs: Math.round(performance.now() - started),
          };
        }
        if (options.acceptEmpty && response.ok && response.status === 204) {
          await response.body?.cancel();
          return {
            value: null,
            finalUrl: currentUrl,
            durationMs: Math.round(performance.now() - started),
          };
        }
        const sse =
          options.mcp &&
          response.headers.get("content-type")?.split(";")[0]?.trim() ===
            "text/event-stream";
        if (
          options.mcp &&
          response.ok &&
          !sse &&
          response.headers.get("content-type")?.split(";")[0]?.trim() !==
            "application/json"
        )
          throw Error("Unsupported MCP response content type");
        let streamed: unknown;
        const reader = response.body?.getReader();
        if (!reader) {
          if (!response.ok)
            throw new ProtocolError(response.status, undefined, retryAt);
          if (options.acceptEmpty && response.status === 200)
            return {
              value: null,
              finalUrl: currentUrl,
              durationMs: Math.round(performance.now() - started),
            };
          throw new Error("Empty discovery response");
        }
        let size = 0;
        const chunks: Uint8Array[] = [];
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            // Error bodies are small, except an approval_required operation.
            if (
              size >
              (response.ok
                ? MAX_DOCUMENT_BYTES
                : response.status === 403
                  ? 65536
                  : 4096)
            )
              throw new Error("Document is too large");
            chunks.push(value);
            if (sse) {
              streamed = sseRpc(Buffer.concat(chunks).toString("utf8"));
              if (streamed !== undefined) break;
            }
          }
        } finally {
          await reader.cancel();
        }
        if (!response.ok) {
          let code: unknown, operation: unknown;
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            code = body.error;
            if (response.status === 403 && code === "approval_required")
              operation = body.operation;
          } catch {
            /* Untrusted error bodies are never surfaced. */
          }
          const challenge = response.headers
            .get("www-authenticate")
            ?.match(/error="([a-z_]+)"/);
          throw new ProtocolError(
            response.status,
            errorCode(code) ?? errorCode(challenge?.[1]),
            retryAt,
            response.headers.get("dpop-nonce") ?? undefined,
            operation,
          );
        }
        return {
          value:
            options.acceptEmpty && size === 0 && response.status === 200
              ? null
              : options.mcp
                ? {
                    message: sse
                      ? streamed
                      : JSON.parse(Buffer.concat(chunks).toString("utf8")),
                    sessionId: response.headers.get("mcp-session-id"),
                  }
                : (JSON.parse(
                    Buffer.concat(chunks).toString("utf8"),
                  ) as unknown),
          finalUrl: currentUrl,
          durationMs: Math.round(performance.now() - started),
        };
      }
    } finally {
      await close();
    }

    if (response.status >= 300 && response.status < 400) {
      if (options.protocol)
        throw new Error("Protocol endpoint redirects are refused");
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS)
        throw new Error("Unsafe or excessive redirect");
      currentUrl = new URL(location, currentUrl);
      continue;
    }

    if (!response.ok)
      throw new Error(`Remote server returned HTTP ${response.status}`);
    throw new Error("Unexpected discovery response");
  }

  throw new Error("Discovery redirect limit reached");
}

export async function discoverCompany(
  input: string,
  options: DiscoveryOptions = {},
): Promise<DiscoveredCompany> {
  const trace: DiscoveryTraceStep[] = [];
  const settings = {
    allowedPrivateOrigins: options.allowedPrivateOrigins ?? [],
    fetchImpl: options.fetchImpl ?? fetch,
    timeoutMs: options.timeoutMs ?? 8_000,
  };

  try {
    if (!input.trim() || input.length > 2048)
      throw new Error("Enter a Company URL of at most 2048 characters");
    const requested = new URL(
      input.includes("://") ? input : `https://${input}`,
    );
    if (requested.username || requested.password)
      throw new Error("URLs with credentials are not allowed");
    trace.push({
      id: "input",
      label: "Company URL",
      detail: requested.origin,
      status: "passed",
    });

    const discoveryUrl = new URL("/.well-known/poppy.json", requested.origin);
    const discovery = await fetchJsonSafely(discoveryUrl, settings);
    // A redirect may change host, but must end at the well-known path itself;
    // otherwise any uploaded file on the domain could speak for it.
    if (
      discovery.finalUrl.pathname !== "/.well-known/poppy.json" ||
      discovery.finalUrl.search
    )
      throw new Error(
        "poppy.json redirect did not end at /.well-known/poppy.json",
      );
    const parsed = poppyDocument03Schema.safeParse(discovery.value);
    if (!parsed.success) {
      const version =
        discovery.value &&
        typeof discovery.value === "object" &&
        "protocol_version" in discovery.value
          ? String(
              (discovery.value as { protocol_version: unknown })
                .protocol_version,
            ).slice(0, 16)
          : "unknown";
      throw new Error(
        version === "0.3"
          ? `Invalid poppy.json: ${parsed.error.issues[0]?.message ?? "schema error"}`
          : `Unsupported PAP version ${version}: this client implements draft 0.3 only`,
      );
    }
    trace.push({
      id: "poppy",
      label: "Discovery document · PAP 0.3",
      detail: discovery.finalUrl.toString(),
      status: "passed",
      durationMs: discovery.durationMs,
    });

    const servedHost = discovery.finalUrl.hostname.toLowerCase();
    if (parsed.data.organization.domain.toLowerCase() !== servedHost) {
      throw new Error(
        "organization.domain does not match the host serving poppy.json",
      );
    }
    trace.push({
      id: "domain",
      label: "Domain binding",
      detail: servedHost,
      status: "passed",
    });
    return {
      requestedUrl: requested.toString(),
      discoveryUrl: discovery.finalUrl.toString(),
      trace,
      discoveredAt: new Date().toISOString(),
      ...(await discover03(
        parsed.data,
        discovery.finalUrl,
        servedHost,
        settings,
        trace,
      )),
    };
  } catch (error) {
    const message =
      error instanceof SyntaxError
        ? "Remote document is not valid JSON"
        : error instanceof Error
          ? error.message
          : "Discovery failed";
    trace.push({
      id: "link",
      label: "Discovery stopped",
      detail: message,
      status: "failed",
    });
    throw new PapDiscoveryError("discovery_failed", message, trace);
  }
}

type FetchSettings = Parameters<typeof fetchJsonSafely>[1];

async function fetchMetadata(issuer: string, settings: FetchSettings) {
  const response = await fetchJsonSafely(
    metadataUrlForIssuer(issuer),
    settings,
  );
  const parsed = authorizationServerMetadataSchema.safeParse(response.value);
  if (!parsed.success)
    throw new Error(
      `Invalid OAuth metadata: ${parsed.error.issues[0]?.message ?? "schema error"}`,
    );
  if (parsed.data.issuer !== issuer)
    throw new Error(
      "OAuth metadata issuer does not exactly match the Company issuer",
    );
  return { metadata: parsed.data, response };
}

/** RFC 9728 §3.3 comparison, except the host ignores case (PAP 0.3 §3.2). */
function sameResource(a: string, b: string) {
  try {
    const x = new URL(a),
      y = new URL(b);
    return (
      x.protocol === y.protocol &&
      x.host.toLowerCase() === y.host.toLowerCase() &&
      a.slice(x.protocol.length + 2 + x.host.length) ===
        b.slice(y.protocol.length + 2 + y.host.length)
    );
  } catch {
    return false;
  }
}

async function discover03(
  document: PoppyDocument03,
  servedUrl: URL,
  servedHost: string,
  settings: FetchSettings,
  trace: DiscoveryTraceStep[],
): Promise<{
  document: PoppyDocument03;
  metadata?: AuthorizationServerMetadata;
  profile: CompanyProfile;
}> {
  // Development-only plain-HTTP exception keeps its explicit port.
  const domainResource = settings.allowedPrivateOrigins.includes(
    servedUrl.origin,
  )
    ? servedUrl.origin
    : `https://${servedHost}`;
  const resourceUrl = new URL(
    "/.well-known/oauth-protected-resource",
    domainResource,
  );
  let authorizationServers: string[] = [];
  try {
    const response = await fetchJsonSafely(resourceUrl, {
      ...settings,
      protocol: true,
    });
    const parsed = protectedResourceMetadataSchema.safeParse(response.value);
    if (!parsed.success)
      throw new Error("Invalid protected resource metadata for the domain");
    if (!sameResource(parsed.data.resource, domainResource))
      throw new Error("Protected resource metadata names a different resource");
    authorizationServers = parsed.data.authorization_servers ?? [];
  } catch (error) {
    // Only an explicit 404 establishes "no issuer"; any other failure stops.
    if (!(error instanceof ProtocolError && error.status === 404)) throw error;
  }
  const declared = document.auth?.issuer;
  if (declared && !authorizationServers.includes(declared))
    throw new Error("auth.issuer is not an authorization server of the domain");
  if (authorizationServers.length > 1 && !declared)
    throw new Error(
      "Several authorization servers: auth.issuer must choose one",
    );
  const issuer = declared ?? authorizationServers[0];
  const scopeHints = normalizeScopeHints(document.auth?.scope_hints);
  const base = {
    scopeDescriptions: document.auth?.scopes ?? {},
    scopeHints,
    ...(document.excluded_tasks
      ? { excludedTasksUrl: document.excluded_tasks.url }
      : {}),
  };
  if (!issuer) {
    if (
      document.agent?.protocols.some(
        (p) => p.type === "poppy" && p.access === "signed_in",
      )
    )
      throw new Error(
        "A conversation that requires sign-in needs an OAuth issuer",
      );
    trace.push({
      id: "resource",
      label: "Protected resource metadata",
      detail: "No issuer: signed-out Sessions only",
      status: "passed",
    });
    return {
      document,
      profile: {
        version: "0.3",
        identifier: domainResource,
        signIn: { direct: false, device: false },
        scopes: [],
        ...base,
      },
    };
  }
  trace.push({
    id: "resource",
    label: "Protected resource metadata",
    detail: resourceUrl.toString(),
    status: "passed",
  });
  trace.push({
    id: "issuer",
    label: "OAuth issuer",
    detail: issuer,
    status: "passed",
  });
  const { metadata, response } = await fetchMetadata(issuer, settings);
  const grants = metadata.grant_types_supported;
  if (!grants?.includes("refresh_token"))
    throw new Error(
      "grant_types_supported must be present and include refresh_token",
    );
  const direct = grants.includes("authorization_code"),
    device = grants.includes("urn:ietf:params:oauth:grant-type:device_code");
  if (direct && !metadata.authorization_endpoint)
    throw new Error("Direct Sign-In requires authorization_endpoint");
  if (device && !metadata.device_authorization_endpoint)
    throw new Error("Device Sign-In requires device_authorization_endpoint");
  trace.push({
    id: "metadata",
    label: "OAuth metadata",
    detail: response.finalUrl.toString(),
    status: "passed",
    durationMs: response.durationMs,
  });
  if (
    !metadata.protected_resources?.some((r) => sameResource(r, domainResource))
  )
    throw new Error(
      "OAuth metadata does not list the domain in protected_resources",
    );
  trace.push({
    id: "link",
    label: "Two-way issuer link",
    detail: `${servedHost} ↔ ${new URL(issuer).host}`,
    status: "passed",
  });
  return {
    document,
    metadata,
    profile: {
      version: "0.3",
      identifier: issuer,
      issuer,
      // §3.2: with auth.disabled, never start any sign-in; identifier stays the issuer.
      signIn:
        document.auth?.disabled === true
          ? { direct: false, device: false }
          : { direct, device },
      scopes:
        metadata.scopes_supported ?? Object.keys(document.auth?.scopes ?? {}),
      ...base,
    },
  };
}

/** Fetch a 0.3 Company's excluded tasks: public GET, no token, no redirects. */
export async function fetchExcludedTasks(
  company: DiscoveredCompany,
  options: DiscoveryOptions = {},
) {
  const url = company.profile?.excludedTasksUrl;
  if (!url || company.document.protocol_version !== "0.3") return [];
  const response = await fetchJsonSafely(new URL(url), {
    allowedPrivateOrigins: options.allowedPrivateOrigins ?? [],
    fetchImpl: options.fetchImpl ?? fetch,
    timeoutMs: options.timeoutMs ?? 8_000,
    protocol: true,
  });
  return parseExcludedTasks(
    response.value,
    company.document as PoppyDocument03,
    options.allowedPrivateOrigins ?? [],
  );
}

export { metadataUrlForIssuer };

export async function protocolRequest(
  url: string,
  request: RequestInit = {},
  allowedPrivateOrigins: readonly string[] = [],
  dpop?: {
    key: JWK;
    token?: string | undefined;
    assertions?: { key: JWK; client: string; issuer: string; user?: string };
    /** Re-signs per-request headers (such as Poppy-Session) for the retry. */
    resign?: () => Promise<Record<string, string>>;
  },
  options?: { acceptEmpty?: boolean },
): Promise<unknown> {
  const send = (init: RequestInit) =>
    fetchJsonSafely(new URL(url), {
      request: init,
      protocol: true,
      acceptEmpty: options?.acceptEmpty ?? false,
      allowedPrivateOrigins,
      fetchImpl: fetch,
      timeoutMs: 15000,
    });
  try {
    return (await send(request)).value;
  } catch (e) {
    // Only a protocol nonce rejection guarantees that the action was not run.
    // No retry on timeout, 5xx, malformed response, or any second challenge.
    if (
      !dpop ||
      !(e instanceof ProtocolError) ||
      ![400, 401].includes(e.status) ||
      e.code !== "use_dpop_nonce" ||
      !e.nonce ||
      !/^[\x21-\x7e]{1,256}$/.test(e.nonce)
    )
      throw e;
    const headers = new Headers(request.headers);
    for (const [name, value] of Object.entries((await dpop.resign?.()) ?? {}))
      headers.set(name, value);
    headers.set(
      "DPoP",
      await proof(dpop.key, url, request.method ?? "GET", dpop.token, e.nonce),
    );
    let body = request.body;
    if (dpop.assertions) {
      const a = dpop.assertions;
      if (typeof body !== "string") throw e;
      const params = new URLSearchParams(body);
      params.set(
        "client_assertion",
        await assertion(a.key, a.client, a.client, a.issuer),
      );
      if (a.user)
        params.set(
          "assertion",
          await assertion(a.key, a.client, a.user, a.issuer),
        );
      body = params.toString();
    }
    return (
      await send({
        ...request,
        headers,
        ...(body === undefined ? {} : { body }),
      })
    ).value;
  }
}
export async function mcpRequest(
  url: string,
  request: RequestInit,
  allowedPrivateOrigins: readonly string[] = [],
  dpop?: {
    key: JWK;
    token?: string | undefined;
    resign?: () => Promise<Record<string, string>>;
  },
): Promise<{ message: unknown; sessionId: string | null }> {
  const send = async (request: RequestInit) =>
    (
      await fetchJsonSafely(new URL(url), {
        request,
        protocol: true,
        mcp: true,
        allowedPrivateOrigins,
        fetchImpl: fetch,
        timeoutMs: 15000,
      })
    ).value as { message: unknown; sessionId: string | null };
  try {
    return await send(request);
  } catch (error) {
    if (
      !dpop ||
      !(error instanceof ProtocolError) ||
      ![400, 401].includes(error.status) ||
      error.code !== "use_dpop_nonce" ||
      !error.nonce ||
      !/^[\x21-\x7e]{1,256}$/.test(error.nonce)
    )
      throw error;
    const headers = new Headers(request.headers);
    for (const [name, value] of Object.entries((await dpop.resign?.()) ?? {}))
      headers.set(name, value);
    headers.set(
      "DPoP",
      await proof(
        dpop.key,
        url,
        request.method ?? "POST",
        dpop.token,
        error.nonce,
      ),
    );
    return send({ ...request, headers });
  }
}
export * from "./session.ts";
export * from "./session-header.ts";
export { decodeProtectedHeader, type JWK } from "jose";
