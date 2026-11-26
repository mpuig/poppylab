/**
 * The Companies of one conversation. A conversation holds a connection for
 * each Company it works with (`Run.connections`), and everything that
 * belongs to a Company is in its connection: the Session, the sign-in, the
 * permissions, the proposals. Code that works at a Company is handed that
 * Company's connection, so it can't read another one's.
 *
 * Plain data and no I/O, for the routes, the stored runs and the tests.
 */
import type { Connection, FormerConnection, Run } from "./runtime";

/** A conversation works with at most this many Companies at a time. */
export const MAX_CONNECTIONS = 3;

/**
 * What names a connection: its Company's origin. Discovery reads a Company
 * at its origin (`/.well-known/poppy.json`), so one origin is one Company.
 */
export const originOf = (connection: Pick<Connection, "url">) =>
  new URL(connection.url).origin;

/** The Company's name as the page says it: its own, or else its host. */
export const companyName = (connection: Pick<Connection, "url" | "company">) =>
  connection.company?.document.organization.name ??
  new URL(connection.url).host;

/**
 * What the conversation keeps says which Company it came from: an entry of
 * the transcript, a line of the Inspector and a turn of the model's context
 * each carry that Company's origin (`company`). The origin, not a place in
 * the list of connections: it still says where an entry came from after
 * the Company was removed (`nameFor`), and a Company connected again finds
 * its own entries.
 */
export type FromCompany = { company?: string };

/** The tag for what comes from this connection's Company. */
export const from = (connection: Pick<Connection, "url">) => ({
  company: originOf(connection),
});

/**
 * Whether something the conversation keeps came from this Company. What
 * names no Company can't be told apart from this Company's, so it counts:
 * a sign-in, a sign-out or a lost access at any Company takes it back.
 */
export const cameFrom = (
  entry: FromCompany,
  connection: Pick<Connection, "url">,
) => entry.company === undefined || entry.company === originOf(connection);

/**
 * The entries as the page gets them, without the Company each came from:
 * with one Company the page has no use for it.
 */
export const untagged = <T extends FromCompany>(
  entries: readonly T[],
): Array<Omit<T, "company">> =>
  entries.map((entry) => {
    const rest: Omit<T, "company"> & FromCompany = { ...entry };
    delete rest.company;
    return rest;
  });

/**
 * The name of the Company an entry came from: the connected one's, or the
 * name it had when it was removed from the conversation, or else its host.
 */
export function nameFor(
  run: Pick<Run, "connections" | "former">,
  origin: string,
) {
  const of = (c: Pick<Connection, "url">) => originOf(c) === origin;
  const connected = run.connections.find(of);
  if (connected) return companyName(connected);
  return run.former?.find(of)?.name ?? new URL(origin).host;
}

/** The conversation's connection to the Company at this address, if any. */
export const connectionAt = (run: Pick<Run, "connections">, url: string) => {
  const origin = new URL(url).origin;
  return run.connections.find((c) => originOf(c) === origin);
};

/**
 * Connects the conversation to one more Company, at any moment of it. The
 * new connection is signed out and has no Session yet: `ensureSession`
 * gives it the User ID for this Company, which no other Company sees. What
 * the conversation already holds is left as it is, each entry still saying
 * which Company it came from.
 *
 * A Company that was removed and is connected again starts the same way.
 * An approval it was left with an unknown outcome stays where it is
 * (`Run.former`), since the new connection has no way to send it again.
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
  // Its name comes from the connection again.
  const former = run.former?.filter(
    (f) => originOf(f) !== originOf(connection) || f.operations,
  );
  if (former?.length) run.former = former;
  else delete run.former;
  return connection;
}

/** A conversation remembers at most this many Companies that left it. */
const MAX_FORMER = 8;

/**
 * Notes that a Company left the conversation: its name, and any approval
 * left with an unknown outcome. Over the bound, the oldest note that holds
 * no such approval goes first.
 */
export function noteFormer(run: Run, left: FormerConnection) {
  const before = run.former?.find((f) => originOf(f) === originOf(left));
  const operations = { ...before?.operations, ...left.operations };
  const former = [
    ...(run.former ?? []).filter((f) => f !== before),
    {
      url: left.url,
      name: left.name,
      ...(Object.keys(operations).length ? { operations } : {}),
    },
  ];
  while (former.length > MAX_FORMER) {
    const spare = former.findIndex((f) => !f.operations);
    former.splice(Math.max(spare, 0), 1);
  }
  run.former = former;
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
