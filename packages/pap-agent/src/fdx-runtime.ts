import {
  fdxStatementPdf,
  fdxTools,
  validFdxId,
  type ApiTool,
} from "@poppy-lab/pap-client";
import { FDX_EXTENSION, type FdxExtensionEntry } from "@poppy-lab/pap-core";
import { DOMAIN_EXTENSIONS } from "./domain-extension";
import { extensionRequest, sendRevocation } from "./extension-request";
import type { Connection } from "./run-types";
import { fdxEntry } from "./session";
import { UserFacingError } from "./user-error";

/** A URL at or under a base URL: same origin, and the base's path segments. */
export function under(url: string, base: string) {
  const u = new URL(url),
    b = new URL(base);
  const path = b.pathname.replace(/\/$/, "");
  return (
    u.origin === b.origin &&
    (u.pathname === path || u.pathname.startsWith(path + "/"))
  );
}

/**
 * Whether an OpenAPI description is the `poppylab.dev/fdx` API: its server
 * is at or under the entry's `base_url`, or every path it describes is. Its
 * address says nothing (Harborline serves it at `/openapi/fdx.json`, outside
 * the base URL, so agents without the extension can read it), and its
 * server may be the Company's origin with `/fdx/v6/...` paths.
 */
export function fdxShaped(
  spec: unknown,
  url: string,
  entry: FdxExtensionEntry,
) {
  const described = spec as {
    servers?: Array<{ url?: unknown }>;
    paths?: unknown;
  } | null;
  const server = described?.servers?.[0]?.url;
  let base: URL;
  try {
    base = new URL(typeof server === "string" ? server : new URL(url).origin);
  } catch {
    return false;
  }
  if (under(base.href, entry.base_url)) return true;
  const paths =
    described?.paths && typeof described.paths === "object"
      ? Object.keys(described.paths)
      : [];
  const prefix = base.pathname.replace(/\/$/, "");
  return (
    paths.length > 0 &&
    paths.every((path) =>
      under(`${base.origin}${prefix}${path}`, entry.base_url),
    )
  );
}

/** With Use FDX on, the tools to use for account data (`fdxConnect`). */
export const FDX_GUIDANCE =
  "The User turned on Use FDX: for accounts, balances, transactions and statements, use these fdx_ tools rather than the Company's own API tools.";

/**
 * `poppylab.dev/fdx` v1: the native, read-only FDX-shaped tools, with Use
 * FDX on. They send what other API tools send: the Session header and the
 * access token (`papRequest`). An FDX-shaped error body reaches the adapter,
 * which bounds it; a Poppy or OAuth error keeps the runtime's handling.
 */
export function fdxConnect(
  connection: Connection,
  entry: FdxExtensionEntry,
  trace: string[],
): Record<string, ApiTool> {
  const tools = fdxTools({
    entry,
    trace: (line) => trace.push(line),
    // The consent id the bank returned at sign-in: the model never names it.
    consentId: () => connection.fdxConsent,
    request: fdxRequest(connection, trace),
  });
  // The User chose this API: steer the model to it. A preference, not a
  // block; the bank applies the accounts chosen at consent to both APIs.
  const list = tools.fdx_list_accounts;
  if (list)
    tools.fdx_list_accounts = {
      ...list,
      description: `${FDX_GUIDANCE} ${list.description}`,
    };
  trace.push(
    `Extension ${FDX_EXTENSION} v1 · native FDX-shaped adapter · ${Object.keys(tools).length} read tools`,
  );
  return tools;
}

const FDX = DOMAIN_EXTENSIONS.find((e) => e.key === "fdx")!;
const fdxRequest = (connection: Connection, trace: string[]) =>
  extensionRequest(connection, FDX, trace);

/**
 * `poppylab.dev/fdx` v1: the native tools for the User's own actions in the
 * account row, built as the model's are: the same transport, scopes and
 * bounds, so the page sees what the model would.
 */
export function fdxUserTools(connection: Connection, trace: string[]) {
  const entry = fdxEntry(connection);
  if (!entry) throw new UserFacingError("Turn on Use FDX first.");
  return fdxTools({
    entry,
    trace: (line) => trace.push(line),
    consentId: () => connection.fdxConsent,
    request: fdxRequest(connection, trace),
  });
}

/**
 * `poppylab.dev/fdx` v1: one statement's PDF for the User to download, never
 * for the model. The URL comes only from the validated entry and the two ids,
 * checked with the adapter's own id rule; the adapter checks the answer is a
 * bounded PDF. Resolves to `{ pdf, sha256 }` or the adapter's error answer.
 */
export async function fdxStatementDownload(
  connection: Connection,
  accountId: unknown,
  statementId: unknown,
  trace: string[],
) {
  const entry = fdxEntry(connection);
  if (!entry) throw new UserFacingError("Turn on Use FDX first.");
  if (!validFdxId(accountId) || !validFdxId(statementId))
    throw new UserFacingError("That isn't a statement of a shared account.");
  return fdxStatementPdf(
    {
      entry,
      request: fdxRequest(connection, trace),
      trace: (line) => trace.push(line),
    },
    accountId,
    statementId,
  );
}

/** The consent id as one path segment, as the token response was checked. */
/** The adapter's id rule: one path segment, base64url ids included. */
const consentSegment = (id: string | undefined) =>
  validFdxId(id) ? id : undefined;

/**
 * `poppylab.dev/fdx` v1: the consent this sign-in holds, when Use FDX is on
 * and the bank returned its id. Only from the validated entry and the id
 * kept from the token response, never from the page.
 */
export function fdxConsentTarget(connection: Connection) {
  const entry = fdxEntry(connection);
  const id = consentSegment(connection.fdxConsent);
  if (
    !entry ||
    !id ||
    !connection.accountToken ||
    connection.accountUnavailable
  )
    return;
  const base = new URL(entry.consent_endpoint.replace(/\/+$/, ""));
  const url = new URL(
    `${base.href.replace(/\/$/, "")}/${encodeURIComponent(id)}/revocation`,
  );
  if (
    url.origin !== base.origin ||
    !url.pathname.startsWith(`${base.pathname.replace(/\/$/, "")}/`)
  )
    return;
  return { entry, id, revocation: url.href };
}

/**
 * Reads the consent record through the native adapter's own
 * `fdx_consent_status`, so the page sees the same bounded fields the model
 * would: status, expiry and the shared accounts.
 */
export async function fdxConsentRecord(
  connection: Connection,
  trace: string[],
) {
  const target = fdxConsentTarget(connection);
  if (!target) throw new UserFacingError("No FDX consent to show.");
  const tools = fdxTools({
    entry: target.entry,
    trace: (line) => trace.push(line),
    consentId: () => target.id,
    request: fdxRequest(connection, trace),
  });
  return (await tools.fdx_consent_status!.execute({})) as Record<
    string,
    unknown
  >;
}

/**
 * `poppylab.dev/fdx` v1: the User revokes the consent, which is the grant
 * (`PUT {consent_endpoint}/{id}/revocation`). It goes through `papRequest`
 * like any FDX-shaped call: Session header, DPoP token, the extension
 * declared. Never a model tool. Resolves once the Company answered 2xx;
 * throws its error otherwise.
 */
export async function revokeFdxConsent(
  connection: Connection,
  trace: string[],
) {
  const target = fdxConsentTarget(connection);
  if (!target) throw new UserFacingError("No FDX consent to revoke.");
  await sendRevocation(
    connection,
    trace,
    "PUT",
    target.revocation,
    "FDX consent",
    {
      reason: "USER_ACTION",
      initiator: "INDIVIDUAL",
    },
  );
}
