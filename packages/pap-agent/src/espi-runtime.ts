import { espiTools, type ApiTool } from "@poppy-lab/pap-client";
import { ESPI_EXTENSION, type EspiExtensionEntry } from "@poppy-lab/pap-core";
import { DOMAIN_EXTENSIONS } from "./domain-extension";
import {
  extensionRequest,
  sendRevocation,
  SIGN_IN_REQUIRED,
} from "./extension-request";
import type { Connection } from "./run-types";
import { espiEntry, hasScope } from "./session";
import { espiUri } from "./token-response";
import { UserFacingError } from "./user-error";

const ESPI = DOMAIN_EXTENSIONS.find((e) => e.key === "espi")!;

/** With Use ESPI on, the tools to use for usage and bills (`espiConnect`). */
export const ESPI_GUIDANCE =
  "The User turned on Use ESPI: for electricity usage, costs and bills, use these espi_ tools rather than the Company's own API tools.";

/**
 * `poppylab.dev/espi` v1: the native, read-only ESPI-shaped tools, as the
 * model and the account row both get them. The subscription and its
 * authorization are the URIs kept from the token response; signed out,
 * every tool answers that the User should sign in, and sends nothing.
 */
function espiToolset(
  connection: Connection,
  entry: EspiExtensionEntry,
  trace: string[],
): Record<string, ApiTool> {
  const tools = espiTools({
    entry,
    trace: (line) => trace.push(line),
    request: extensionRequest(connection, ESPI, trace),
    resourceUri: () => connection.espiResourceUri,
    authorizationUri: () => connection.espiAuthorizationUri,
  });
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [
      name,
      {
        ...tool,
        execute: async (input?: Record<string, unknown>) =>
          connection.accountToken ? tool.execute(input) : SIGN_IN_REQUIRED,
      },
    ]),
  );
}

/**
 * `poppylab.dev/espi` v1, with Use ESPI on: the ESPI-shaped tools for the
 * model, which send what other API tools send (`papRequest`) and ask for
 * Atom XML. The utility applies the meters chosen at consent to both APIs.
 */
export function espiConnect(
  connection: Connection,
  entry: EspiExtensionEntry,
  trace: string[],
): Record<string, ApiTool> {
  const tools = espiToolset(connection, entry, trace);
  // The User chose this API: steer the model to it. A preference, not a
  // block.
  const meters = tools.espi_meters;
  if (meters)
    tools.espi_meters = {
      ...meters,
      description: `${ESPI_GUIDANCE} ${meters.description}`,
    };
  trace.push(
    `Extension ${ESPI_EXTENSION} v1 · native ESPI-shaped adapter · ${Object.keys(tools).length} read tools`,
  );
  return tools;
}

/** The ESPI-shaped tools for the User's own actions in the account row. */
export function espiUserTools(connection: Connection, trace: string[]) {
  const entry = espiEntry(connection);
  if (!entry) throw new UserFacingError("Turn on Use ESPI first.");
  return espiToolset(connection, entry, trace);
}

/**
 * `poppylab.dev/espi` v1: the authorization this sign-in holds, when Use
 * ESPI is on and the utility returned its URI. Only the URI kept from the
 * token response, checked again against the entry; never from the page.
 */
export function espiAuthorizationTarget(connection: Connection) {
  const entry = espiEntry(connection);
  if (!entry || !connection.accountToken || connection.accountUnavailable)
    return;
  const url = espiUri(entry, connection.espiAuthorizationUri, "Authorization");
  return url ? { entry, url, id: url.split("/").at(-1)! } : undefined;
}

/**
 * The subscription as the page shows it: the authorization's status,
 * period and expiry through `espi_authorization`, and the meters it shares
 * through `espi_meters` when the grant reads usage. The same bounded fields
 * the model would get.
 */
export async function espiAuthorizationRecord(
  connection: Connection,
  trace: string[],
) {
  const target = espiAuthorizationTarget(connection);
  if (!target) throw new UserFacingError("No ESPI authorization to show.");
  const tools = espiToolset(connection, target.entry, trace);
  const authorization = (await tools.espi_authorization!.execute({})) as Record<
    string,
    unknown
  >;
  const meters = hasScope(connection, "espi:usage")
    ? ((await tools.espi_meters!.execute({})) as Record<string, unknown>)
    : undefined;
  return { authorization, meters };
}

/**
 * `poppylab.dev/espi` v1: the User revokes the authorization, which is the
 * grant (`DELETE {authorizationURI}`). Through `papRequest` like any
 * ESPI-shaped call: Session header, DPoP token, the extension declared.
 * Never a model tool.
 */
export async function revokeEspiAuthorization(
  connection: Connection,
  trace: string[],
) {
  const target = espiAuthorizationTarget(connection);
  if (!target) throw new UserFacingError("No ESPI authorization to revoke.");
  await sendRevocation(
    connection,
    trace,
    "DELETE",
    target.url,
    "ESPI authorization",
  );
}
