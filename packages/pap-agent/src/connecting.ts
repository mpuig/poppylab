/**
 * Connecting a Company to a conversation that is already going on, from
 * the page (discovery) or from the User's own words in the chat. Discovery
 * reads the Company's public documents with no credential of anyone's, so
 * nothing the conversation holds for another Company is sent.
 */
import { discoverCompany } from "@poppy-lab/pap-client";
import {
  addConnection,
  companyName,
  connectionAt,
  MAX_CONNECTIONS,
} from "./connections";
import { bytesOf, RUN_LIMITS } from "./run-size";
import type { Connection, Run } from "./runtime";

/** Why a Company can't be connected, in words the page can show. */
export type ConnectRefusal = {
  code: "already_connected" | "too_many_companies" | "conversation_full";
  error: string;
};

/**
 * Whether the conversation can't take the Company at this address: it is
 * connected to it already, or to as many as a conversation works with.
 * Asked before discovery, so a refusal fetches nothing, and again with the
 * address discovery settled on.
 */
export function connectRefusal(
  run: Pick<Run, "connections">,
  url: string,
): ConnectRefusal | undefined {
  const connected = connectionAt(run, url);
  if (connected)
    return {
      code: "already_connected",
      error: `This conversation is already connected to ${companyName(connected)}.`,
    };
  if (run.connections.length >= MAX_CONNECTIONS)
    return {
      code: "too_many_companies",
      error: `A conversation works with at most ${MAX_CONNECTIONS} companies. Remove one to connect another.`,
    };
  return undefined;
}

/**
 * Connects the conversation to the Company at `url`: reads its discovery,
 * then adds a connection for it, signed out. Returns the refusal instead
 * when the conversation can't take it, which includes a Company whose
 * documents would take the stored conversation over the size a further
 * Company is taken at; a discovery that fails throws
 * (`PapDiscoveryError`), and nothing is added.
 */
export async function connectCompany(
  run: Run,
  url: string,
  allowedPrivateOrigins: string[],
): Promise<Connection | ConnectRefusal> {
  const refusal = connectRefusal(run, url);
  if (refusal) return refusal;
  const company = await discoverCompany(url, { allowedPrivateOrigins });
  const settled = connectRefusal(run, company.requestedUrl);
  if (settled) return settled;
  // What the Company publishes is kept with the conversation, and a
  // conversation is one stored value of a bounded size (`run-size.ts`).
  // Measured before anything is added, so a refusal changes nothing.
  if (bytesOf(run) + bytesOf(company) > RUN_LIMITS.connect) {
    const name = company.document.organization.name;
    return {
      code: "conversation_full",
      error: `This conversation holds too much to take ${name} as well. Remove a company, or start a new conversation to connect ${name}.`,
    };
  }
  const connection = addConnection(run, company.requestedUrl);
  connection.company = company;
  return connection;
}
