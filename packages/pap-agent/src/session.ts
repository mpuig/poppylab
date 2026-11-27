import {
  createSessionKey,
  extensionsHeader,
  newSessionId,
  operatorDirectory,
  operatorSignatureHeaders,
  POPPY_VERSION,
  proof,
  sessionKeyUsable,
  signSessionHeader,
} from "@poppy-lab/pap-client";
import {
  companyProfile,
  ESPI_EXTENSION,
  FDX_EXTENSION,
  type EspiExtensionEntry,
  type FdxExtensionEntry,
} from "@poppy-lab/pap-core";
import type { JWK } from "jose";
import {
  agentFor,
  clientFor,
  identity,
  operatorKey,
  userFor,
} from "./agent-keys";
import { isAccountCompany } from "./deployment";
import {
  DOMAIN_EXTENSIONS,
  extensionsOn,
  type DomainExtension,
} from "./domain-extension";
import type { Connection } from "./run-types";

export const hasScope = (connection: Connection, scope: string) =>
  !!connection.accountToken &&
  (connection.scopes ?? "").split(" ").includes(scope);

/** Account Companies this playground may sign in to and accept proposals from. */
export function accountConfiguration(connection: Connection) {
  const company = connection.company,
    origin = new URL(connection.url).origin;
  if (
    !isAccountCompany(origin) ||
    !company ||
    companyProfile(company).issuer !== origin ||
    !company.metadata ||
    company.metadata.issuer !== origin
  )
    throw Error("Unsupported account connection");
  // Operations v3 needs no endpoint at APIs and conversations (§2).
  const endpoints = {
    ...company.metadata,
    operations: companyProfile(company).operations,
  };
  for (const value of [
    endpoints.token_endpoint,
    endpoints.revocation_endpoint,
    endpoints.authorization_endpoint,
    ...(endpoints.pushed_authorization_request_endpoint
      ? [endpoints.pushed_authorization_request_endpoint]
      : []),
  ])
    if (!value || new URL(value).origin !== origin)
      throw Error("Unsupported account endpoints");
  return endpoints;
}

/** Starts or continues this connection's Session: User ID, `sid` and delegated key. */
export async function ensureSession(connection: Connection) {
  const profile = companyProfile(connection.company!);
  if (!connection.visitor) throw Error("Connection without a visitor");
  const user = await userFor(
    connection.visitor,
    profile.identifier,
    connection.epoch,
  );
  if (connection.user !== user) {
    // New Company identifier: new User ID, Session and delegated key (§3.2).
    connection.user = user;
    delete connection.sessionId;
    delete connection.sessionKey;
  }
  connection.sessionId ??= newSessionId();
  if (!sessionKeyUsable(connection.sessionKey))
    connection.sessionKey = await createSessionKey(
      (await identity()).privateKey,
      clientFor(connection),
    );
}

/** Starts a new Session with a fresh `sid` (after `session_ended`, §5.5). */
export function newSession(connection: Connection) {
  connection.sessionId = newSessionId();
  delete connection.tasks;
}

/**
 * `poppylab.dev/fdx` v1 (§3.3): the Company's validated entry, when Use FDX
 * is on. A profile saved before profiles kept extensions has none.
 */
export function fdxEntry(
  connection: Connection,
): FdxExtensionEntry | undefined {
  return connection.fdx
    ? connection.company?.profile?.extensions?.[FDX_EXTENSION]
    : undefined;
}

/**
 * `poppylab.dev/espi` v1 (§3.3): the Company's validated entry, when Use
 * ESPI is on.
 */
export function espiEntry(
  connection: Connection,
): EspiExtensionEntry | undefined {
  return connection.espi
    ? connection.company?.profile?.extensions?.[ESPI_EXTENSION]
    : undefined;
}

/**
 * §3.3, §3.4: the extensions this Session declares, name → version: each
 * one the Company lists, Operations v3 always and a domain extension (the
 * FDX-shaped or the ESPI-shaped one) only with Use FDX or Use ESPI on.
 */
export function declaredExtensions(
  connection: Connection,
): Record<string, string> {
  const on = extensionsOn(connection);
  return {
    ...(companyProfile(connection.company!).operations
      ? { operations: "3" }
      : {}),
    ...Object.fromEntries(
      DOMAIN_EXTENSIONS.filter((e) => on[e.key]).map((e) => [e.name, "1"]),
    ),
  };
}

/**
 * Turns a domain extension (Use FDX, Use ESPI) on or off. A Session's
 * declarations don't change (§3.4), so a change starts a new Session.
 * Returns whether anything changed.
 */
export function setExtension(
  connection: Connection,
  key: DomainExtension["key"],
  on: boolean,
) {
  if (!!connection[key] === on) return false;
  if (on) connection[key] = true;
  else delete connection[key];
  newSession(connection);
  return true;
}
/** Turns Use FDX on or off (`setExtension`). */
export const setFdx = (connection: Connection, on: boolean) =>
  setExtension(connection, "fdx", on);

export async function sessionHeaders(
  connection: Connection,
  url: string,
  method: string,
  token?: { value: string; type: "DPoP" | "Bearer"; key?: JWK | undefined },
) {
  await ensureSession(connection);
  const profile = companyProfile(connection.company!);
  const session = await signSessionHeader({
    key: connection.sessionKey!,
    clientId: clientFor(connection),
    audience: profile.identifier,
    sessionId: connection.sessionId!,
    userId: connection.user,
    method,
    url,
    ...(token ? { accessToken: token.value } : {}),
  });
  const authorization = token
    ? `${token.type === "DPoP" ? "DPoP" : "Bearer"} ${token.value}`
    : undefined;
  const extensions = extensionsHeader(declaredExtensions(connection));
  return {
    "Poppy-Session": session,
    // §5.3: the operator signature, last, over the Session JWT and token.
    ...(await operatorSignatureHeaders({
      key: await operatorKey(),
      agent: operatorDirectory(agentFor(connection)),
      method,
      url,
      poppySession: session,
      ...(authorization ? { authorization } : {}),
    })),
    // §3.4: the same on every request in a Session. Extensions are declared
    // only when the Company lists them (guides: Versions).
    "Poppy-Version": POPPY_VERSION,
    ...(extensions ? { "Poppy-Extensions": extensions } : {}),
    ...(token
      ? token.type === "DPoP"
        ? {
            Authorization: authorization!,
            DPoP: await proof(token.key!, url, method, token.value),
          }
        : { Authorization: authorization! }
      : {}),
  };
}
