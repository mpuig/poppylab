/** Shared in-memory Harborline PAP test harness. */
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
import { harborline } from "./harborline.ts";

export const origin = "http://harbor.localhost:4300";
export const client = "http://localhost:3000/agent/client.json";
export const redirect = "http://localhost:3000/api/account/callback";
export const lab = {} as { app: ReturnType<typeof createCompany> };
type Inject = {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  payload?: Record<string, unknown>;
};
export async function inject(input: Inject | string) {
  const options = typeof input === "string" ? { url: input } : input;
  const form =
    options.method === "POST" &&
    (options.url.startsWith("/oauth/") || options.url === "/site/login");
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

export async function setup(deploy: Partial<Deployment> = {}) {
  const keys = await createIdentity();
  const dpop = await createIdentity();
  lab.app = createCompany(harborline, {
    origin,
    store: memoryStore(),
    httpClients: [client],
    fetchJson: async (url) =>
      url.endsWith("client.json")
        ? {
            client_id: client,
            client_name: "Iris",
            jwks_uri: "http://localhost:3000/agent/jwks.json",
            redirect_uris: [redirect],
          }
        : { keys: [keys.publicKey] },
    ...deploy,
  });
  const sessionKey = await createSessionKey(keys.privateKey, client);
  const sessionIds = new Map<string, string>();
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
  const sign = async (
    account: "avery" | "jordan",
    requested: string[],
    options: { allowOffline?: boolean; allowChanges?: boolean } = {},
  ) => {
    const verifier = "v".repeat(64);
    const page = await inject(
      `/oauth/authorize?${new URLSearchParams({ client_id: client, redirect_uri: redirect, response_type: "code", state: "s".repeat(32), scope: requested.join(" "), code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") })}`,
    );
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("Harborline Bank");
    expect(page.body).toContain("No real account exists");
    const cookie = String(page.headers["set-cookie"]).split(";")[0]!;
    const payload: Record<string, string> = {
      nonce: cookie.split("=")[1]!,
      decision: "approve",
      account,
    };
    if (options.allowChanges !== false)
      for (const scope of requested)
        if (scope.endsWith(":write") || scope.endsWith(":request"))
          payload[`allow_${scope.replace(/[:_]/g, "_")}`] = "yes";
    if (options.allowOffline) payload.allow_offline = "yes";
    const consent = await inject({
      method: "POST",
      url: "/oauth/authorize",
      headers: { cookie, origin },
      payload,
    });
    expect(consent.statusCode).toBe(302);
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
    return issued as {
      access_token: string;
      refresh_token: string;
      scope?: string;
    };
  };
  const call = async (
    access: string,
    method: "GET" | "POST",
    url: string,
    payload?: Record<string, unknown>,
    approval?: { operation_id: string; revision: string },
    user = "usr_harborline",
    extra: Record<string, string> = {},
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
            sessionIds.get(access) ??
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
  return { sign, call, token, keys, dpop, sessionKey };
}
