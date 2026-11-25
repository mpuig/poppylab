/** In-memory Northwind Company with signed PAP Session and OAuth helpers. */
import { createHash } from "node:crypto";
import { expect } from "vitest";
import {
  approvalHeader,
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
import { northwind } from "./northwind.ts";

export const origin = "http://northwind.localhost:4400";
export const client = "http://localhost:3000/agent/client.json";
export const redirect = "http://localhost:3000/api/account/callback";
export const lab = {} as {
  app: ReturnType<typeof createCompany>;
  store: ReturnType<typeof memoryStore>;
};
type Inject = {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  payload?: Record<string, unknown>;
};
export async function inject(input: Inject | string) {
  const options = typeof input === "string" ? { url: input } : input;
  const form = options.url.startsWith("/oauth/") && options.method === "POST";
  const response = await lab.app.request(options.url, {
    method: options.method ?? "GET",
    headers: {
      ...(options.payload
        ? {
            "content-type": form
              ? "application/x-www-form-urlencoded"
              : "application/json",
          }
        : {}),
      ...options.headers,
    },
    ...(options.payload
      ? {
          body: form
            ? new URLSearchParams(
                options.payload as Record<string, string>,
              ).toString()
            : JSON.stringify(options.payload),
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

const readScopes = "flights:search bookings:read profile:read";
const allScopes = `${readScopes} preferences:write bookings:change`;

export async function setup(deploy: Partial<Deployment> = {}) {
  const keys = await createIdentity();
  const dpop = await createIdentity();
  const store = memoryStore();
  lab.store = store;
  lab.app = createCompany(northwind, {
    origin,
    store,
    httpClients: [client],
    fetchJson: async (url) =>
      url.endsWith("client.json")
        ? {
            client_id: client,
            client_name: "Iris",
            jwks_uri: "http://localhost:3000/agent/jwks.json",
            redirect_uris: [redirect],
            extensions: { operations: { version: "3" } },
          }
        : { keys: [keys.publicKey] },
    ...deploy,
  });
  const sessionKey = await createSessionKey(keys.privateKey, client);
  const sessionIds = new Map<string, string>();
  const token = async (payload: Record<string, string>) =>
    (
      await inject({
        method: "POST",
        url: "/oauth/token",
        headers: {
          DPoP: await proof(dpop.privateKey, `${origin}/oauth/token`, "POST"),
        },
        payload: {
          ...payload,
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
      `/oauth/authorize?${new URLSearchParams({
        client_id: client,
        redirect_uri: redirect,
        response_type: "code",
        state: "s".repeat(32),
        scope: write ? allScopes : readScopes,
        code_challenge_method: "S256",
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
      })}`,
    );
    expect(page.body).toContain("Northwind Air");
    expect(page.body).toContain("Iris");
    const consentCookie = String(page.headers["set-cookie"])
      .split(/,(?=\s*\w+=)|;\s*/)
      .find((entry) => entry.includes("pap_consent_"))!
      .trim();
    const consent = await inject({
      method: "POST",
      url: "/oauth/authorize",
      headers: { cookie: consentCookie, origin },
      payload: {
        nonce: consentCookie.split("=")[1],
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
    sessionIds.set(issued.access_token, newSessionId());
    return issued;
  };
  const call = async (
    access: string,
    method: "GET" | "POST",
    url: string,
    payload?: Record<string, unknown>,
    approval?: { operation_id: string; revision: string },
    user = "usr_northwind",
    extra: Record<string, string> = {},
    sid?: string,
  ) =>
    inject({
      method,
      url,
      headers: {
        "Poppy-Version": "1.0",
        "Poppy-Extensions": '"operations";v="3"',
        ...extra,
        "Poppy-Session": await signSessionHeader({
          key: sessionKey,
          clientId: client,
          audience: origin,
          sessionId:
            sid ??
            (user === "usr_northwind" ? sessionIds.get(access) : undefined) ??
            sessionIds.get(user) ??
            (sessionIds.set(user, newSessionId()), sessionIds.get(user))!,
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
              "Poppy-Approval": approvalHeader({
                ...approval,
                approver: "user",
                approved_at: Math.floor(Date.now() / 1000),
                input_type: "tap",
              }),
            }
          : {}),
      },
      ...(payload ? { payload } : {}),
    });
  return { sign, call, token, keys, dpop, sessionKey, store };
}
