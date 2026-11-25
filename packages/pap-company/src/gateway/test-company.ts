/**
 * TEST ONLY. A small Company on the gateway, with a Company Agent, and a
 * Personal Agent's keys to call it: form posts to the OAuth endpoints,
 * signed-out conversation requests, Direct Sign-In and signed calls with a
 * DPoP-bound token.
 */
import { createHash } from "node:crypto";
import {
  assertion,
  createIdentity,
  createSessionKey,
  newSessionId,
  proof,
  signSessionHeader,
} from "@poppy-lab/pap-client/core";
import { createCompany } from "../gateway.ts";
import { memoryStore } from "../memory.ts";
import type { CompanyDefinition, Deployment } from "./types.ts";

export const origin = "https://company.test",
  client = "https://agent.test/client.json",
  redirect = "https://agent.test/callback";

const company: CompanyDefinition = {
  name: "Test Company",
  readScope: "things:read",
  writeScope: "things:write",
  consent: ({ nonce }) => `<p>${nonce}</p>`,
  persona: (id) => (id === "elena" ? { id: "elena" } : undefined),
  defaultAccount: "elena",
  discovery: () => ({}),
  paths: {},
  agent: {
    name: "Test agent",
    handoff: { text: "Call us.", data: { phone: "555 0100" } },
  },
  mount: (_app, ctx) => ctx.converse(() => ({ replies: [{ text: "ok" }] })),
};

/** `overrides` replace fields of the test Company's definition. */
export async function setup(
  deploy: Partial<Deployment> = {},
  overrides: Partial<CompanyDefinition> = {},
) {
  const keys = await createIdentity();
  const dpop = await createIdentity();
  const store = memoryStore();
  /** A test sets `wait` to hold metadata fetches, so requests interleave. */
  const metadata: { wait?: () => Promise<void> } = {};
  const app = createCompany(
    { ...company, ...overrides },
    {
      origin,
      store,
      fetchJson: async (url) => {
        await metadata.wait?.();
        return url === client
          ? {
              client_id: client,
              client_name: "Agent",
              jwks_uri: "https://agent.test/jwks.json",
              redirect_uris: [redirect],
            }
          : { keys: [keys.publicKey] };
      },
      ...deploy,
    },
  );
  /** The client's fields of an OAuth request, with a fresh assertion. */
  const credentials = async () => ({
    client_id: client,
    client_assertion_type:
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: await assertion(keys.privateKey, client, client, origin),
  });
  const form = (
    path: string,
    body: Record<string, string>,
    headers: Record<string, string> = {},
  ) =>
    app.request(path, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: new URLSearchParams(body).toString(),
    });
  const sessionKey = await createSessionKey(keys.privateKey, client);
  const sessionId = newSessionId();
  /** A signed-out request of one User, as JSON. */
  const post = async (path: string, body: Record<string, unknown>) =>
    app.request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Poppy-Version": "1.0",
        "Poppy-Session": await signSessionHeader({
          key: sessionKey,
          clientId: client,
          audience: origin,
          sessionId,
          userId: "usr_test",
          method: "POST",
          url: origin + path,
        }),
      },
      body: JSON.stringify(body),
    });
  type Tokens = { access_token: string; refresh_token: string; scope?: string };
  /** The token endpoint, with the agent's DPoP key. */
  const token = async (body: Record<string, string>) => {
    const r = await form(
      "/oauth/token",
      { ...body, ...(await credentials()) },
      { DPoP: await proof(dpop.privateKey, `${origin}/oauth/token`, "POST") },
    );
    if (r.status !== 200) throw new Error(`token: ${await r.text()}`);
    return (await r.json()) as Tokens;
  };
  /**
   * Direct Sign-In as Elena; `consent` adds fields to the consent form, and
   * `browser` is the `pap_browser` cookie of the browser that approves.
   */
  const signIn = async (
    scope = "things:read",
    consent: Record<string, string> = {},
    browser?: string,
  ) => {
    const verifier = "v".repeat(64);
    const page = await app.request(
      `/oauth/authorize?${new URLSearchParams({
        client_id: client,
        redirect_uri: redirect,
        response_type: "code",
        scope,
        state: "s".repeat(32),
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
      })}`,
      browser ? { headers: { cookie: browser } } : {},
    );
    if (page.status !== 200) throw new Error(`authorize: ${page.status}`);
    // With visitor isolation a browser cookie comes first.
    const cookie = page.headers
      .getSetCookie()
      .find((c) => c.includes("pap_consent_"))!
      .split(";")[0]!;
    const approved = await form(
      "/oauth/authorize",
      {
        nonce: cookie.split("=")[1]!,
        decision: "approve",
        account: "elena",
        write: "yes",
        ...consent,
      },
      { cookie: browser ? `${cookie}; ${browser}` : cookie, origin },
    );
    const location = approved.headers.get("location");
    if (approved.status !== 302 || !location)
      return { refused: approved } as const;
    const code = new URL(location).searchParams.get("code")!;
    return token({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: redirect,
    });
  };
  /** A signed call: the User's Session, and the token when given. */
  const call = async (
    path: string,
    options: {
      method?: "GET" | "POST" | "PUT";
      access?: string;
      extensions?: string;
      user?: string;
      session?: string;
      /** A `Poppy-Approval` header (Operations v3 §6). */
      approval?: string;
      /** A JSON body for a POST or PUT (default `{}`). */
      body?: Record<string, unknown>;
    } = {},
  ) => {
    const method = options.method ?? "GET";
    const { access } = options;
    return app.request(path, {
      method,
      headers: {
        "Poppy-Version": "1.0",
        ...(options.extensions !== undefined
          ? { "Poppy-Extensions": options.extensions }
          : {}),
        ...(options.approval ? { "Poppy-Approval": options.approval } : {}),
        "Poppy-Session": await signSessionHeader({
          key: sessionKey,
          clientId: client,
          audience: origin,
          sessionId: options.session ?? sessionId,
          userId: options.user ?? "usr_test",
          method,
          url: origin + path,
          ...(access ? { accessToken: access } : {}),
        }),
        ...(access
          ? {
              Authorization: `DPoP ${access}`,
              DPoP: await proof(dpop.privateKey, origin + path, method, access),
            }
          : {}),
        ...(method !== "GET" ? { "content-type": "application/json" } : {}),
      },
      ...(method !== "GET" ? { body: JSON.stringify(options.body ?? {}) } : {}),
    });
  };
  return { app, store, metadata, credentials, form, post, token, signIn, call };
}
