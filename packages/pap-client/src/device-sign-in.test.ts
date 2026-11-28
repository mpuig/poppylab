/**
 * Device Sign-In as a Personal Agent does it (§4.3): the link's host is
 * checked before anything is shown, the device_code stays out of what the
 * User sees, and every poll carries a fresh client assertion.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { afterEach, expect, it, vi } from "vitest";
import type { DiscoveredCompany } from "@poppy-lab/pap-core";
import {
  createIdentity,
  deviceLinkAllowed,
  pollDeviceSignIn,
  ProtocolError,
  startDeviceSignIn,
  waitForDeviceSignIn,
  type DeviceClient,
} from "./index.ts";

const DEVICE_CODE = "secret-device-code-0123456789";
let server: Server | undefined;
afterEach(() => server?.close());

type Seen = { path: string; body: URLSearchParams; dpop?: string };

/** A Company that answers each request with the next of `answers`. */
async function company(
  answers: Array<(origin: string) => [number, Record<string, unknown>]>,
) {
  const seen: Seen[] = [];
  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    seen.push({
      path: req.url ?? "",
      body: new URLSearchParams(Buffer.concat(chunks).toString()),
      ...(req.headers.dpop ? { dpop: String(req.headers.dpop) } : {}),
    });
    const [status, body] = answers.shift()!(origin);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  const discovered = {
    document: {
      organization: { name: "Juniper Market", domain: new URL(origin).host },
    },
    metadata: {
      issuer: origin,
      token_endpoint: `${origin}/oauth/token`,
      revocation_endpoint: `${origin}/oauth/revoke`,
      device_authorization_endpoint: `${origin}/oauth/device`,
    },
    profile: {
      issuer: origin,
      identifier: origin,
      signIn: { direct: true, device: true },
    },
  } as unknown as DiscoveredCompany;
  const keys = await createIdentity(),
    dpop = await createIdentity();
  const client: DeviceClient = {
    clientId: "https://agent.test/client.json",
    key: keys.privateKey,
    dpop: dpop.privateKey,
    allowedPrivateOrigins: [origin],
  };
  return { origin, discovered, client, seen };
}

const started =
  (overrides: Record<string, unknown> = {}) =>
  (origin: string): [number, Record<string, unknown>] => [
    200,
    {
      device_code: DEVICE_CODE,
      user_code: "WDJB-MJHT",
      verification_uri: `${origin}/device`,
      verification_uri_complete: `${origin}/device?user_code=WDJB-MJHT`,
      expires_in: 600,
      interval: 5,
      ...overrides,
    },
  ];
const oauthError = (error: string) => (): [number, Record<string, unknown>] => [
  400,
  { error },
];

it("starts with the scopes and an assertion, and shows no device_code", async () => {
  const x = await company([started()]);
  const before = Date.now();
  const { prompt, pending } = await startDeviceSignIn(
    x.discovered,
    "poppy:read",
    x.client,
  );
  expect(prompt).toMatchObject({
    company: "Juniper Market",
    domain: new URL(x.origin).host,
    verificationUri: `${x.origin}/device`,
    verificationUriComplete: `${x.origin}/device?user_code=WDJB-MJHT`,
    userCode: "WDJB-MJHT",
  });
  expect(JSON.stringify(prompt)).not.toContain(DEVICE_CODE);
  expect(pending.deviceCode).toBe(DEVICE_CODE);
  expect(pending.expiresAt).toBeGreaterThanOrEqual(before + 600000);
  expect(pending.nextPollAt).toBeGreaterThanOrEqual(before + 5000);

  const [request] = x.seen;
  expect(request!.path).toBe("/oauth/device");
  expect(request!.body.get("scope")).toBe("poppy:read");
  expect(request!.body.get("client_id")).toBe(x.client.clientId);
  expect(decodeJwt(request!.body.get("client_assertion")!).aud).toBe(x.origin);
  expect(decodeProtectedHeader(request!.dpop!).typ).toBe("dpop+jwt");
});

it("refuses a link that isn't on the Company's issuer or domain", async () => {
  for (const link of [
    "https://elsewhere.example/device",
    "http://127.0.0.2/device",
  ]) {
    const x = await company([started({ verification_uri: link })]);
    await expect(
      startDeviceSignIn(x.discovered, "poppy:read", x.client),
    ).rejects.toThrow("isn't shown");
    server!.close();
  }
  const x = await company([
    started({ verification_uri_complete: "https://elsewhere.example/d" }),
  ]);
  await expect(
    startDeviceSignIn(x.discovered, "poppy:read", x.client),
  ).rejects.toThrow("isn't shown");
});

it("allows the issuer's host, the domain and their subdomains, on the same port", () => {
  const issuer = "https://auth.example.com",
    domain = "example.com";
  for (const link of [
    "https://auth.example.com/device",
    "https://example.com/device",
    "https://login.example.com/device",
    "https://eu.auth.example.com/device?user_code=WDJB-MJHT",
  ])
    expect(deviceLinkAllowed(link, issuer, domain)).toBe(true);
  for (const link of [
    "https://example.com.evil.test/device",
    "https://notexample.com/device",
    "https://example.com:8443/device",
    "http://example.com/device",
    "https://user@example.com/device",
    "not a link",
  ])
    expect(deviceLinkAllowed(link, issuer, domain)).toBe(false);
  // A domain with a port allows that port only.
  expect(
    deviceLinkAllowed(
      "https://shop.test:8443/device",
      "https://shop.test:8443",
      "shop.test:8443",
    ),
  ).toBe(true);
  // An address has no subdomains.
  expect(
    deviceLinkAllowed(
      "https://1.127.0.0.1/device",
      "https://127.0.0.1",
      "127.0.0.1",
    ),
  ).toBe(false);
});

it("polls through pending and slow_down to the tokens", async () => {
  const x = await company([
    started(),
    oauthError("authorization_pending"),
    oauthError("slow_down"),
    () => [
      200,
      {
        access_token: "at",
        token_type: "DPoP",
        expires_in: 3600,
        refresh_token: "rt",
      },
    ],
  ]);
  const { pending } = await startDeviceSignIn(
    x.discovered,
    "poppy:read poppy:write",
    x.client,
  );
  const now = Date.now();
  const first = await pollDeviceSignIn(pending, x.client, now);
  expect(first.status).toBe("pending");
  if (first.status !== "pending") return;
  expect(first.pending.interval).toBe(5);
  const second = await pollDeviceSignIn(first.pending, x.client, now + 5000);
  if (second.status !== "pending") throw new Error(second.status);
  // RFC 8628 §3.5: five seconds more, for this and every later poll.
  expect(second.pending.interval).toBe(10);
  expect(second.pending.nextPollAt).toBe(now + 15000);
  const done = await pollDeviceSignIn(second.pending, x.client, now + 15000);
  expect(done).toEqual({
    status: "approved",
    tokens: {
      accessToken: "at",
      tokenType: "DPoP",
      expiresIn: 3600,
      refreshToken: "rt",
      // No `scope`: every scope asked for was granted (§4.7).
      scope: "poppy:read poppy:write",
    },
  });
  // Each poll: the grant, the device_code, a fresh assertion and a proof.
  const polls = x.seen.slice(1);
  expect(polls.map((p) => p.body.get("grant_type"))).toEqual(
    Array(3).fill("urn:ietf:params:oauth:grant-type:device_code"),
  );
  expect(polls.every((p) => p.body.get("device_code") === DEVICE_CODE)).toBe(
    true,
  );
  const ids = polls.map((p) => decodeJwt(p.body.get("client_assertion")!).jti);
  expect(new Set(ids).size).toBe(3);
  expect(polls.every((p) => p.dpop)).toBe(true);
});

it("reports a decline and an expiry, and throws other errors", async () => {
  const x = await company([
    started(),
    oauthError("access_denied"),
    oauthError("expired_token"),
    oauthError("invalid_grant"),
  ]);
  const { pending } = await startDeviceSignIn(
    x.discovered,
    "poppy:read",
    x.client,
  );
  expect(await pollDeviceSignIn(pending, x.client)).toEqual({
    status: "declined",
  });
  expect(await pollDeviceSignIn(pending, x.client)).toEqual({
    status: "expired",
  });
  await expect(pollDeviceSignIn(pending, x.client)).rejects.toBeInstanceOf(
    ProtocolError,
  );
  // Past its end, nothing is sent.
  const sent = x.seen.length;
  expect(await pollDeviceSignIn(pending, x.client, pending.expiresAt)).toEqual({
    status: "expired",
  });
  expect(x.seen).toHaveLength(sent);
});

it("waits between polls until the User answers", async () => {
  const x = await company([
    started(),
    oauthError("authorization_pending"),
    oauthError("authorization_pending"),
    oauthError("access_denied"),
  ]);
  const { pending } = await startDeviceSignIn(
    x.discovered,
    "poppy:read",
    x.client,
  );
  const result = await waitForDeviceSignIn(
    // Twenty milliseconds, for the test's sake.
    { ...pending, interval: 0.02, nextPollAt: Date.now() },
    x.client,
  );
  expect(result).toEqual({ status: "declined" });
  expect(x.seen).toHaveLength(4);
});

it("aborts immediately before sleeping and removes abort listeners when timers win", async () => {
  const x = await company([
    started(),
    oauthError("authorization_pending"),
    oauthError("authorization_pending"),
    oauthError("access_denied"),
  ]);
  const { pending } = await startDeviceSignIn(
    x.discovered,
    "poppy:read",
    x.client,
  );

  // Already-aborted signal rejects before waiting for a long nextPollAt.
  const already = new AbortController();
  already.abort(new Error("cancelled"));
  const before = Date.now();
  await expect(
    waitForDeviceSignIn(
      { ...pending, nextPollAt: Date.now() + 60_000 },
      x.client,
      { signal: already.signal },
    ),
  ).rejects.toThrow("cancelled");
  expect(Date.now() - before).toBeLessThan(1000);
  expect(x.seen).toHaveLength(1);

  // When timers complete across polls, every abort listener is cleaned up.
  const active = new AbortController();
  const addSpy = vi.spyOn(active.signal, "addEventListener");
  const removeSpy = vi.spyOn(active.signal, "removeEventListener");
  const result = await waitForDeviceSignIn(
    { ...pending, interval: 0.02, nextPollAt: Date.now() + 20 },
    x.client,
    { signal: active.signal },
  );
  expect(result).toEqual({ status: "declined" });
  expect(addSpy).toHaveBeenCalledTimes(3);
  expect(removeSpy).toHaveBeenCalledTimes(3);
  for (let i = 0; i < 3; i++)
    expect(removeSpy.mock.calls[i]![1]).toBe(addSpy.mock.calls[i]![1]);
});

it("doesn't start where the Company offers no Device Sign-In", async () => {
  const x = await company([]);
  const discovered = {
    ...x.discovered,
    profile: {
      ...x.discovered.profile,
      signIn: { direct: true, device: false },
    },
  };
  await expect(
    startDeviceSignIn(discovered, "poppy:read", x.client),
  ).rejects.toThrow("doesn't offer Device Sign-In");
  expect(x.seen).toHaveLength(0);
});
