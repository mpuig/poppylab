/**
 * PAP 1.0 behaviours of the shared gateway, through Lantern: the discovery
 * document and tasks response, Poppy-Version and Poppy-Extensions, Sessions
 * named by client, sid and User ID, session_ended, Pushed Authorization
 * Requests with a DPoP-bound code, and refresh only with the same DPoP key.
 */
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  assertion,
  createIdentity,
  newSessionId,
  proof,
} from "@poppy-lab/pap-client/core";
import { client, inject, origin, redirect, setup } from "./test-harness.ts";

it("publishes a 1.0 document, its tasks, PAR and both signing algorithms", async () => {
  await setup();
  const doc = (await inject("/.well-known/poppy.json")).json();
  expect(doc).toMatchObject({
    protocol_version: "1.0",
    organization: { domain: "noodles.localhost:4200" },
    tasks: { endpoint: `${origin}/poppy/tasks` },
    extensions: { operations: [{ version: "3" }] },
  });
  expect(doc).not.toHaveProperty("excluded_tasks");
  const tasks = await inject("/poppy/tasks");
  expect(tasks.statusCode).toBe(200);
  expect(
    tasks.json().excluded_tasks.map((t: { task: string }) => t.task),
  ).toContain("Cancel an order");
  const metadata = (
    await inject("/.well-known/oauth-authorization-server")
  ).json();
  expect(metadata).toMatchObject({
    pushed_authorization_request_endpoint: `${origin}/oauth/par`,
    require_pushed_authorization_requests: false,
    token_endpoint_auth_signing_alg_values_supported: ["ES256", "PS384"],
  });
  const resource = (
    await inject("/.well-known/oauth-protected-resource")
  ).json();
  expect(resource.scopes_supported).toEqual(["orders:read", "orders:write"]);
});

it("checks Poppy-Version and reads Poppy-Extensions (§3.4)", async () => {
  const x = await setup();
  for (const version of ["", "0.3", "2.0"]) {
    const r = await x.call(
      "",
      "GET",
      "/api/menu",
      undefined,
      undefined,
      undefined,
      {
        "Poppy-Version": version,
      },
    );
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ error: "version_unsupported" });
  }
  // A later 1.x Personal Agent is compatible.
  expect(
    (
      await x.call("", "GET", "/api/menu", undefined, undefined, undefined, {
        "Poppy-Version": "1.1",
      })
    ).statusCode,
  ).toBe(200);
  // A change without the extension declared: extension_required, as JSON only.
  const elena = await x.sign("elena", true);
  const r = await x.call(
    elena.access_token,
    "POST",
    "/api/account/orders/ord_LNB1001/changes",
    { slot_id: "sun-1300" },
    undefined,
    undefined,
    { "Poppy-Extensions": '"operations";v="2"' },
  );
  expect(r.statusCode).toBe(403);
  expect(r.json()).toEqual({
    error: "extension_required",
    extension: "operations",
  });
  expect(r.headers["www-authenticate"]).toBeUndefined();
});

it("names a Session by client, sid and User ID, and ends it on a second account (§5.3–5.4)", async () => {
  const x = await setup();
  const sid = newSessionId();
  const ok = (r: { statusCode: number }) => expect(r.statusCode).toBe(200);
  ok(
    await x.call(
      "",
      "GET",
      "/api/menu",
      undefined,
      undefined,
      "usr_a",
      {},
      sid,
    ),
  );
  // The same sid with another User ID is another Session, not an error.
  ok(
    await x.call(
      "",
      "GET",
      "/api/menu",
      undefined,
      undefined,
      "usr_b",
      {},
      sid,
    ),
  );
  const elena = await x.sign("elena", false);
  const robin = await x.sign("robin", false);
  const shared = newSessionId();
  ok(
    await x.call(
      elena.access_token,
      "GET",
      "/api/account/orders",
      undefined,
      undefined,
      "usr_noodles",
      {},
      shared,
    ),
  );
  const second = await x.call(
    robin.access_token,
    "GET",
    "/api/account/orders",
    undefined,
    undefined,
    "usr_noodles",
    {},
    shared,
  );
  expect(second.statusCode).toBe(400);
  expect(second.json()).toEqual({ error: "session_ended" });
});

it("signs in through a pushed request, binding the code and refresh token to the DPoP key (§4.2, §4.4)", async () => {
  const x = await setup();
  const verifier = "p".repeat(64);
  const pushedCode = async () => {
    const response = await formPost(
      "/oauth/par",
      {
        response_type: "code",
        client_id: client,
        redirect_uri: redirect,
        scope: "orders:read",
        state: "s".repeat(32),
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
        client_assertion_type:
          "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: await assertion(
          x.keys.privateKey,
          client,
          client,
          origin,
        ),
      },
      { DPoP: await proof(x.dpop.privateKey, `${origin}/oauth/par`, "POST") },
    );
    expect(response.status).toBe(201);
    const { request_uri, expires_in } = (await response.json()) as {
      request_uri: string;
      expires_in: number;
    };
    expect(request_uri).toMatch(/^urn:ietf:params:oauth:request_uri:/);
    expect(expires_in).toBeGreaterThan(0);
    // Only client_id and request_uri in the browser, once.
    const page = await inject(
      `/oauth/authorize?${new URLSearchParams({ client_id: client, request_uri })}`,
    );
    expect(page.statusCode).toBe(200);
    expect(
      (
        await inject(
          `/oauth/authorize?${new URLSearchParams({ client_id: client, request_uri })}`,
        )
      ).json().error,
    ).toBe("invalid_request_uri");
    const cookie = String(page.headers["set-cookie"])
      .split(/,(?=\s*\w+=)|;\s*/)
      .find((c) => c.includes("pap_consent_"))!
      .trim();
    const consent = await inject({
      method: "POST",
      url: "/oauth/authorize",
      headers: { cookie, origin },
      payload: {
        nonce: cookie.split("=")[1]!,
        decision: "approve",
        account: "elena",
      },
    });
    const code = new URL(String(consent.headers.location)).searchParams.get(
      "code",
    )!;
    return code;
  };
  const code = await pushedCode();
  const exchange = async (
    key: Awaited<ReturnType<typeof createIdentity>>,
    body: Record<string, string>,
  ) =>
    formPost(
      "/oauth/token",
      {
        ...body,
        client_id: client,
        client_assertion_type:
          "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: await assertion(
          x.keys.privateKey,
          client,
          client,
          origin,
        ),
      },
      { DPoP: await proof(key.privateKey, `${origin}/oauth/token`, "POST") },
    );
  const other = await createIdentity();
  // Another key can't redeem the code pushed with this one.
  const stolen = await exchange(other, {
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: redirect,
  });
  expect(((await stolen.json()) as { error: string }).error).toBe(
    "invalid_grant",
  );
  // The key it was pushed with redeems a fresh code.
  const redeemed = await exchange(x.dpop, {
    grant_type: "authorization_code",
    code: await pushedCode(),
    code_verifier: verifier,
    redirect_uri: redirect,
  });
  expect(redeemed.status).toBe(200);
});

it("refreshes only with the DPoP key the refresh token was issued with (§4.4)", async () => {
  const x = await setup();
  const elena = await x.sign("elena", false);
  const refresh = async (
    key: Awaited<ReturnType<typeof createIdentity>>,
    extra: Record<string, string> = {},
  ) =>
    formPost(
      "/oauth/token",
      {
        grant_type: "refresh_token",
        refresh_token: elena.refresh_token,
        client_id: client,
        client_assertion_type:
          "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: await assertion(
          x.keys.privateKey,
          client,
          client,
          origin,
        ),
        ...extra,
      },
      { DPoP: await proof(key.privateKey, `${origin}/oauth/token`, "POST") },
    );
  const other = await createIdentity();
  expect(
    ((await (await refresh(other)).json()) as { error: string }).error,
  ).toBe("invalid_grant");
  expect((await refresh(x.dpop)).status).toBe(200);
  // §4.5: naming the domain gets the default token; anything else is refused.
  expect((await refresh(x.dpop, { resource: origin })).status).toBe(200);
  expect(
    (
      (await (
        await refresh(x.dpop, { resource: "https://elsewhere.example" })
      ).json()) as {
        error: string;
      }
    ).error,
  ).toBe("invalid_target");
  // An unknown refresh token is invalid_grant even without a DPoP proof, so
  // a verifier can tell the client assertion was accepted; a real one still
  // needs its key.
  const bare = async (refresh_token: string) =>
    (
      (await (
        await formPost("/oauth/token", {
          grant_type: "refresh_token",
          refresh_token,
          client_id: client,
          client_assertion_type:
            "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
          client_assertion: await assertion(
            x.keys.privateKey,
            client,
            client,
            origin,
          ),
        })
      ).json()) as { error: string }
    ).error;
  expect(await bare("rt_unknown")).toBe("invalid_grant");
  expect(await bare(elena.refresh_token)).toBe("invalid_dpop_proof");
});

/** A form POST through the Company under test. */
async function formPost(
  url: string,
  body: Record<string, string>,
  headers: Record<string, string> = {},
) {
  const { lab } = await import("./test-harness.ts");
  return lab.app.request(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: new URLSearchParams(body).toString(),
  });
}

it("takes feedback with the Session header: 202, or 200 with Lantern's alternative (§9.3)", async () => {
  const x = await setup();
  expect((await inject("/poppy/tasks")).json().feedback).toEqual({
    endpoint: `${origin}/poppy/feedback`,
  });
  const report = (task: string, description = "The User wanted it.") =>
    x.call("", "POST", "/poppy/feedback", { task, description });
  const plain = await report("Choose the spice level per bowl");
  expect(plain.statusCode).toBe(202);
  expect(plain.body).toBe("");
  const alt = await report("Buy a gift card");
  expect(alt.statusCode).toBe(200);
  expect(alt.json().instructions).toContain("+1 555-0142");
  // Malformed or too long: invalid_request.
  for (const body of [
    { task: "x" },
    { task: "", description: "d" },
    { task: "x".repeat(201), description: "d" },
    { task: "x", description: "d".repeat(2001) },
  ]) {
    const r = await x.call("", "POST", "/poppy/feedback", body);
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ error: "invalid_request" });
  }
  // Without a Session header, nothing is accepted (§5.3).
  const bare = await inject({
    url: "/poppy/feedback",
    method: "POST",
    payload: { task: "x", description: "d" },
  });
  expect(bare.statusCode).toBe(400);
});
