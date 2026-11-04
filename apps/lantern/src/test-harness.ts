/** Shared Lantern test harness: an in-memory Company, sign-in and signed calls. */
import { createHash } from "node:crypto";
import { expect } from "vitest";
import {
  assertion,
  createIdentity,
  createSessionKey,
  newSessionId,
  proof,
  signSessionHeader,
} from "@poppy-lab/pap-client/core";
import {
  createCompany,
  memoryStore,
  type Deployment,
} from "@poppy-lab/pap-company";
import { lantern } from "./lantern.ts";
export const origin = "http://noodles.localhost:4200",
  client = "http://localhost:3000/agent/client.json",
  redirect = "http://localhost:3000/api/account/callback";
/** The Company under test; `setup` replaces it. */
export const lab = {} as { app: ReturnType<typeof createCompany> };
/** Fastify-like inject over Hono's Web Request API. */
type Inject = {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  payload?: Record<string, unknown>;
};
export async function inject(input: Inject | string) {
  const o = typeof input === "string" ? { url: input } : input;
  const form = o.url.startsWith("/oauth/") && o.method === "POST";
  const response = await lab.app.request(o.url, {
    method: o.method ?? "GET",
    headers: {
      ...(o.payload
        ? {
            "content-type": form
              ? "application/x-www-form-urlencoded"
              : "application/json",
          }
        : {}),
      ...o.headers,
    },
    ...(o.payload
      ? {
          body: form
            ? new URLSearchParams(
                o.payload as Record<string, string>,
              ).toString()
            : JSON.stringify(o.payload),
        }
      : {}),
  });
  const body = await response.text();
  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
    json: () => JSON.parse(body),
  };
}

export async function setup(deploy: Partial<Deployment> = {}) {
  const keys = await createIdentity(),
    dpop = await createIdentity();
  lab.app = createCompany(lantern, {
    origin,
    domain: "noodles.localhost",
    store: memoryStore(),
    httpClients: [client],
    fetchJson: async (url) =>
      url.endsWith("client.json")
        ? {
            client_id: client,
            client_name: "Iris",
            jwks_uri: "http://localhost:3000/agent/jwks.json",
            redirect_uris: [redirect],
            extensions: { operations: { version: "2" } },
          }
        : { keys: [keys.publicKey] },
    ...deploy,
  });
  const sessionKey = await createSessionKey(keys.privateKey, client);
  const sids = new Map<string, string>();
  const token = async (body: Record<string, string>) =>
    (
      await inject({
        method: "POST",
        url: "/oauth/token",
        headers: {
          DPoP: await proof(dpop.privateKey, `${origin}/oauth/token`, "POST"),
        },
        payload: {
          ...body,
          client_id: client,
          client_assertion_type:
            "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
          client_assertion: await assertion(
            keys.privateKey,
            client,
            client,
            origin,
          ),
        },
      })
    ).json();
  const sign = async (account: string, write: boolean) => {
    const verifier = "v".repeat(64);
    const page = await inject(
      `/oauth/authorize?${new URLSearchParams({ client_id: client, redirect_uri: redirect, response_type: "code", state: "s".repeat(32), scope: write ? "orders:read orders:write" : "orders:read", code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") })}`,
    );
    expect(page.body).toContain("Lantern Noodle Bar");
    // The self-asserted name always comes with the verified client_id host.
    expect(page.body).toContain("Connecting Iris from localhost:3000");
    const cookie = String(page.headers["set-cookie"]).split(";")[0]!;
    const consent = await inject({
      method: "POST",
      url: "/oauth/authorize",
      headers: { cookie, origin },
      payload: {
        nonce: cookie.split("=")[1],
        decision: "approve",
        account,
        ...(write ? { write: "yes" } : {}),
      },
    });
    const code = new URL(String(consent.headers.location)).searchParams.get(
      "code",
    )!;
    const issued = await token({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: redirect,
    });
    sids.set(issued.access_token, newSessionId());
    return issued;
  };
  const call = async (
    access: string,
    method: "GET" | "POST",
    url: string,
    payload?: Record<string, unknown>,
    approval?: { operation_id: string; revision: string },
    user = "usr_noodles",
  ) =>
    inject({
      method,
      url,
      headers: {
        "Poppy-Session": await signSessionHeader({
          key: sessionKey,
          clientId: client,
          audience: origin,
          sessionId:
            (user === "usr_noodles" ? sids.get(access) : undefined) ??
            sids.get(user) ??
            (sids.set(user, newSessionId()), sids.get(user))!,
          userId: user,
          method,
          url: origin + url,
          ...(access ? { accessToken: access } : {}),
        }),
        ...(access
          ? {
              Authorization: `DPoP ${access}`,
              DPoP: await proof(dpop.privateKey, origin + url, method, access),
            }
          : {}),
        ...(approval
          ? {
              "Poppy-Approval": `operation_id="${approval.operation_id}", revision="${approval.revision}"`,
            }
          : {}),
      },
      ...(payload ? { payload } : {}),
    });
  return { sign, call, token };
}
