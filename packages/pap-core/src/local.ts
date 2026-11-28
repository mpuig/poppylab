/**
 * The lab's addresses in local development (plain HTTP, development only):
 * the playground on `localhost:3000` and each Company on its own
 * `*.localhost` name, from 4100 to 4500.
 *
 * `POPPY_LOCAL_PORT_OFFSET` moves every port by the same number, so a
 * second set of the lab's servers can run beside a developer's own: the
 * browser scenario (`pnpm e2e`) runs on 23000 and 24100 to 24500. The
 * playground's page bundles get the same number from `next.config.ts`.
 */
function portOffset() {
  let raw: string | undefined;
  try {
    // Written out in full, so a bundler can put the value in its place;
    // a runtime without `process` has no offset.
    raw = process.env.POPPY_LOCAL_PORT_OFFSET;
  } catch {
    raw = undefined;
  }
  if (!raw) return 0;
  const offset = Number(raw);
  if (!Number.isInteger(offset) || offset < 0 || offset > 60000)
    throw new Error(
      "Invalid POPPY_LOCAL_PORT_OFFSET: use a whole number from 0 to 60000",
    );
  return offset;
}
const offset = portOffset();
const at = (host: string, port: number) => `http://${host}:${port + offset}`;

/** Each local address, by the lab's key for its site. */
export const LOCAL_ORIGINS = {
  playground: at("localhost", 3000),
  juniper: at("juniper.localhost", 4100),
  lantern: at("noodles.localhost", 4200),
  harborline: at("harbor.localhost", 4300),
  northwind: at("northwind.localhost", 4400),
  fernwick: at("fernwick.localhost", 4500),
} as const;

/** The local agent, which the local Companies accept as their one client. */
export const LOCAL_AGENT_ORIGIN = LOCAL_ORIGINS.playground;
