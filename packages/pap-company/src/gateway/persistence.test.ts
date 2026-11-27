/**
 * A request saves what it changed when it ends, whatever other requests do
 * meanwhile, and one that changed nothing saves nothing.
 */
import { afterEach, expect, it, vi } from "vitest";
import { tokenHash } from "@poppy-lab/pap-client/core";
import { client, origin, setup } from "./test-company.ts";
import { emptyState, type GatewayState } from "./types.ts";

/** A store that keeps what it last saved, as a restart would load it. */
function recording() {
  const store = {
    value: emptyState(),
    saves: 0,
    saved: undefined as GatewayState | undefined,
    save() {
      store.saves++;
      store.saved = JSON.parse(JSON.stringify(store.value)) as GatewayState;
    },
  };
  return store;
}
/** Holds client-metadata fetches: `reached` once one waits, until `release`. */
function hold(metadata: { wait?: () => Promise<void> }) {
  let arrived!: () => void, release!: () => void;
  const reached = new Promise<void>((done) => (arrived = done));
  const held = new Promise<void>((done) => (release = done));
  metadata.wait = () => {
    arrived();
    return held;
  };
  return { reached, release };
}
const discovery = "/.well-known/oauth-authorization-server";

afterEach(() => vi.useRealTimers());

it("saves a token issued while another request came and went", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const store = recording();
  const x = await setup({ store });
  const first = await x.signIn();
  if ("refused" in first) throw new Error("sign-in refused");
  // Past the 60 seconds the client's metadata is cached for, so the refresh
  // waits for it to be fetched again.
  vi.setSystemTime(Date.now() + 61000);
  const fetch = hold(x.metadata);
  const refreshing = x.token({
    grant_type: "refresh_token",
    refresh_token: first.refresh_token,
  });
  await fetch.reached;
  // A discovery read, start to end, while the refresh waits.
  const saves = store.saves;
  expect((await x.app.request(discovery)).status).toBe(200);
  expect(store.saves).toBe(saves);
  fetch.release();
  const refreshed = await refreshing;
  // Accepted, so saved: a restart still knows the token it just gave out.
  expect(Object.keys(store.saved!.tokens)).toContain(
    tokenHash(refreshed.access_token),
  );
  expect(store.saves).toBe(saves + 1);
});

it("saves nothing for a read that another request's change overlapped", async () => {
  const store = recording();
  const x = await setup({ store });
  // A consent page nobody gets (the redirect isn't the client's): it waits
  // for the client's metadata and changes nothing.
  const fetch = hold(x.metadata);
  const reading = x.app.request(
    `/oauth/authorize?${new URLSearchParams({
      client_id: client,
      redirect_uri: "https://elsewhere.test/callback",
      response_type: "code",
      scope: "things:read",
      state: "s".repeat(32),
      code_challenge: "c".repeat(43),
      code_challenge_method: "S256",
    })}`,
  );
  await fetch.reached;
  // A POST, start to end, while the read waits: saved, as any POST is.
  const posted = await x.form(
    "/oauth/authorize",
    { nonce: "unknown" },
    { origin },
  );
  expect(posted.status).toBe(400);
  expect(store.saves).toBe(1);
  fetch.release();
  expect((await reading).status).toBe(400);
  expect(store.saves).toBe(1);
});

it("answers 503 from a failed save on, until a restart", async () => {
  const store = recording();
  const x = await setup({ store });
  store.save = () => {
    throw new Error("disk full");
  };
  const failed = await x.form("/oauth/authorize", { nonce: "unknown" });
  expect(failed.status).toBe(503);
  expect(await failed.json()).toEqual({
    error: "storage_unavailable_restart_required",
  });
  // Even a read that would save nothing, and even once the store works.
  store.save = () => {};
  const later = await x.app.request(discovery);
  expect(later.status).toBe(503);
  expect(later.headers.get("retry-after")).toBe("60");
});

it("keeps browsers on HTTPS at an HTTPS origin, and only there", async () => {
  const hsts = async (deploy: { origin?: string }, path = discovery) =>
    (await (await setup(deploy)).app.request(path)).headers.get(
      "strict-transport-security",
    );
  // Every answer, an error too; no subdomains, no preload list.
  expect(await hsts({})).toBe("max-age=31536000");
  expect(await hsts({}, "/nowhere")).toBe("max-age=31536000");
  expect(await hsts({ origin: "http://juniper.localhost:4100" })).toBeNull();
  expect(await hsts({ origin: "https://localhost:8443" })).toBeNull();
  expect(await hsts({ origin: "https://shop.localhost" })).toBeNull();
});
