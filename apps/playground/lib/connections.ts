/**
 * The Companies of one conversation. A conversation holds a connection for
 * each Company it works with (`Run.connections`), and everything that
 * belongs to a Company is in its connection: the Session, the sign-in, the
 * permissions, the proposals. Code that works at a Company is handed that
 * Company's connection, so it can't read another one's.
 *
 * Plain data and no I/O, for the routes, the stored runs and the tests.
 */
import type { Connection, Run } from "./runtime";

/** A conversation works with at most this many Companies at a time. */
export const MAX_CONNECTIONS = 3;

/**
 * What names a connection: its Company's origin. Discovery reads a Company
 * at its origin (`/.well-known/poppy.json`), so one origin is one Company.
 */
export const originOf = (connection: Pick<Connection, "url">) =>
  new URL(connection.url).origin;

/** The conversation's connection to the Company at this address, if any. */
export const connectionAt = (run: Pick<Run, "connections">, url: string) => {
  const origin = new URL(url).origin;
  return run.connections.find((c) => originOf(c) === origin);
};

/**
 * Connects the conversation to one more Company. The new connection is
 * signed out and has no Session yet: `ensureSession` gives it the User ID
 * for this Company, which no other Company sees. What the conversation
 * already holds is left as it is.
 */
export function addConnection(run: Run, url: string): Connection {
  if (connectionAt(run, url))
    throw new Error("The conversation is already connected to this Company");
  if (run.connections.length >= MAX_CONNECTIONS)
    throw new Error("The conversation has its three Companies already");
  const connection: Connection = {
    url,
    user: "",
    ...(run.visitor ? { visitor: run.visitor } : {}),
    ...(run.epoch ? { epoch: run.epoch } : {}),
  };
  run.connections.push(connection);
  return connection;
}

/**
 * The connection of a conversation that has exactly one, for the routes
 * that don't yet say which Company a request is for. Each use is a place
 * where a conversation with several Companies must choose one instead.
 */
export function onlyConnection(run: Pick<Run, "connections">): Connection {
  const [only, ...others] = run.connections;
  if (!only || others.length)
    throw new Error(`Expected one connection, found ${run.connections.length}`);
  return only;
}

/** The connection whose sign-in is waiting for this OAuth state. */
export const connectionForState = (
  run: Pick<Run, "connections">,
  state: string,
) => run.connections.find((c) => c.auth?.state === state);
