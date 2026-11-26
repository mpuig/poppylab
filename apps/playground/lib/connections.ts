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
 * A conversation can be started at an address that isn't one, which
 * discovery then refuses: such an address names only itself.
 */
export function originOf(connection: Pick<Connection, "url">) {
  try {
    return new URL(connection.url).origin;
  } catch {
    return connection.url;
  }
}

/** An address's host, or the address itself when it isn't one. */
function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** The Company's name as the page says it: its own, or else its host. */
export const companyName = (connection: Pick<Connection, "url" | "company">) =>
  connection.company?.document.organization.name ?? hostOf(connection.url);

/**
 * What the conversation keeps says which Company it came from: an entry of
 * the transcript, a line of the Inspector and a turn of the model's context
 * each carry that Company's origin (`company`). The origin, not a place in
 * the list of connections: it still says where an entry came from after
 * the Company was removed (`nameFor`), and a Company connected again finds
 * its own entries.
 *
 * An entry and a turn also list the Companies whose accounts could be in
 * them (`accounts`, by origin): each Company that was signed in and whose
 * words could have reached it. For an answer of the demo's rules that is
 * the Company the turn was with. A model is sent the last turns of the
 * whole conversation, so its answer to a turn with one Company can repeat
 * what it read with another's account, and then lists both. What was
 * stored before entries listed them has no `accounts`.
 */
export type FromCompany = { company?: string; accounts?: string[] };

/** The tag for what comes from this connection's Company. */
export const from = (connection: Pick<Connection, "url">) => ({
  company: originOf(connection),
});

/**
 * Whether something the conversation keeps came from this Company. What
 * names no Company, and was stored before entries listed their accounts,
 * can't be told apart from this Company's, so it counts: a sign-in, a
 * sign-out or a lost access at any Company takes it back. What lists its
 * accounts and names no Company is Iris's own and came from none.
 */
export const cameFrom = (
  entry: FromCompany,
  connection: Pick<Connection, "url">,
) =>
  entry.company === undefined
    ? entry.accounts === undefined
    : entry.company === originOf(connection);

/**
 * Whether this Company's account could be in something the conversation
 * keeps, whichever Company it came from. A sign-in, a sign-out or a lost
 * access at this Company takes that back with the Company's own.
 */
export const holdsAccount = (
  entry: FromCompany,
  connection: Pick<Connection, "url">,
) => !!entry.accounts?.includes(originOf(connection));

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
  return run.former?.find(of)?.name ?? hostOf(origin);
}

/**
 * A Company as the page is told of it: its origin, which is what names it
 * in a request, and its name to show.
 */
export type CompanyRef = { origin: string; name: string };
export const companyRef = (
  run: Pick<Run, "connections" | "former">,
  origin: string,
): CompanyRef => ({ origin, name: nameFor(run, origin) });

/**
 * The entries as the page gets them: each says which Company it came from
 * (`from`), so a page that shows several can label it, and none says whose
 * accounts could be in it. What names no Company has no `from`.
 */
export const forPage = <T extends FromCompany>(
  run: Pick<Run, "connections" | "former">,
  entries: readonly T[],
): Array<Omit<T, "company" | "accounts"> & { from?: CompanyRef }> =>
  entries.map((entry) => {
    const rest: Omit<T, "company" | "accounts"> & FromCompany = { ...entry };
    delete rest.company;
    delete rest.accounts;
    return entry.company === undefined
      ? rest
      : { ...rest, from: companyRef(run, entry.company) };
  });

/** The conversation's connection to the Company at this address, if any. */
export const connectionAt = (run: Pick<Run, "connections">, url: string) => {
  const origin = originOf({ url });
  return run.connections.find((c) => originOf(c) === origin);
};

/** Why a request can't be taken to one of the conversation's Companies. */
export type NoCompany = {
  code: "no_company" | "company_required" | "company_not_connected";
  error: string;
};

/**
 * The connection a request is for. The request names its Company by
 * origin (any address there will do). A conversation with one Company may
 * leave it out, as a page that shows one Company does; with several, the
 * request has to say which, so that a sign-in or an approval never goes
 * to a Company the User wasn't looking at.
 */
export function connectionNamed(
  run: Pick<Run, "connections">,
  company: unknown,
): Connection | NoCompany {
  if (company !== undefined) {
    const named =
      typeof company === "string" ? connectionAt(run, company) : undefined;
    return (
      named ?? {
        code: "company_not_connected",
        error: "This conversation isn't connected to that company.",
      }
    );
  }
  const [only, ...others] = run.connections;
  if (!only)
    return {
      code: "no_company",
      error:
        "This conversation isn't connected to a company. Connect one first.",
    };
  if (others.length)
    return {
      code: "company_required",
      error: `This conversation works with ${run.connections.map(companyName).join(", ")}. Choose which one this is for.`,
    };
  return only;
}

/**
 * A connection for the conversation to a Company: signed out, and with no
 * Session yet. `ensureSession` gives it the User ID for this Company from
 * the conversation's visitor, which no other Company sees. The address is
 * taken as it was typed: discovery says whether there is a Company there.
 */
export const newConnection = (
  run: Pick<Run, "visitor" | "epoch">,
  url: string,
): Connection => ({
  url,
  user: "",
  ...(run.visitor ? { visitor: run.visitor } : {}),
  ...(run.epoch ? { epoch: run.epoch } : {}),
});

/**
 * Connects the conversation to one more Company, at any moment of it, with
 * a new connection (`newConnection`). What the conversation already holds
 * is left as it is, each entry still saying which Company it came from.
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
  const connection = newConnection(run, url);
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
