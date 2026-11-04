/** Shared Juniper test harness: public visitors with their own Sessions and grants. */
import { createHash } from "node:crypto";
import {
  assertion,
  createIdentity,
  createSessionKey,
  newSessionId,
  proof,
  signSessionHeader,
} from "@poppy-lab/pap-client/core";
import { juniperApp, localClient } from "./test-app.js";

export const origin = "https://juniper.example",
  client = localClient.client_id,
  redirect = localClient.redirect_uris[0]!;

/** One visitor of a public Poppy: its own user id, Session and grant. */
export async function visitors() {
  const keys = await createIdentity();
  const app = juniperApp({
    isolation: "visitor",
    portal: true,
    origin: "https://juniper.example",
    fetchJson: async (url) =>
      url.endsWith("client.json")
        ? { ...localClient, extensions: { operations: { version: "2" } } }
        : { keys: [keys.publicKey] },
  });
  const key = await createSessionKey(keys.privateKey, client);
  async function visitor(user: string, browser?: { cookie: string }) {
    const dpop = await createIdentity(),
      sid = newSessionId(),
      verifier = "v".repeat(64);
    const page = await app.inject({
      headers: browser?.cookie ? { cookie: browser.cookie } : {},
      url: `/oauth/authorize?${new URLSearchParams({
        client_id: client,
        redirect_uri: redirect,
        response_type: "code",
        state: "s".repeat(32),
        scope: "poppy:read poppy:write",
        code_challenge_method: "S256",
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
      })}`,
    });
    const cookies = ([] as string[]).concat(page.headers["set-cookie"] ?? []);
    const cookie = cookies
      .find((c) => c.includes("pap_consent_"))!
      .split(";")[0]!;
    if (browser && !browser.cookie)
      browser.cookie = cookies
        .find((c) => c.includes("pap_browser="))!
        .split(";")[0]!;
    const consent = await app.inject({
      method: "POST",
      url: "/oauth/authorize",
      headers: {
        cookie: [cookie, browser?.cookie].filter(Boolean).join("; "),
        origin,
      },
      payload: {
        nonce: cookie.split("=")[1]!,
        decision: "approve",
        account: "alex",
        write: "yes",
      },
    });
    const code = new URL(String(consent.headers.location)).searchParams.get(
      "code",
    )!;
    const issued = (
      await app.inject({
        method: "POST",
        url: "/oauth/token",
        headers: {
          DPoP: await proof(dpop.privateKey, `${origin}/oauth/token`, "POST"),
        },
        payload: {
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          redirect_uri: redirect,
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
    const access = issued.access_token as string;
    return async (
      method: "GET" | "POST",
      url: string,
      payload?: unknown,
      approval?: { operation_id: string; revision: string },
    ) =>
      app.inject({
        method,
        url,
        headers: {
          "Poppy-Session": await signSessionHeader({
            key,
            clientId: client,
            audience: origin,
            sessionId: sid,
            userId: user,
            method,
            url: origin + url,
            accessToken: access,
          }),
          Authorization: `DPoP ${access}`,
          DPoP: await proof(dpop.privateKey, origin + url, method, access),
          ...(approval
            ? {
                "Poppy-Approval": `operation_id="${approval.operation_id}", revision="${approval.revision}"`,
              }
            : {}),
        },
        ...(payload ? { payload } : {}),
      });
  }
  /** A signed-out caller: a Session header only. */
  const anonymous =
    (user: string, sid = newSessionId()) =>
    async (method: "GET" | "POST", url: string, payload?: unknown) =>
      app.inject({
        method,
        url,
        headers: {
          "Poppy-Session": await signSessionHeader({
            key,
            clientId: client,
            audience: origin,
            sessionId: sid,
            userId: user,
            method,
            url: origin + url,
          }),
        },
        ...(payload ? { payload } : {}),
      });
  return { app, visitor, anonymous };
}

/** Logs a browser into the Company website as Alex; returns its cookies. */
export async function webLogin(
  app: Awaited<ReturnType<typeof visitors>>["app"],
  browser = "",
) {
  const page = await app.inject({
    url: "/site/login",
    headers: browser ? { cookie: browser } : {},
  });
  const set = ([] as string[]).concat(page.headers["set-cookie"] ?? []);
  const jar = [browser, ...set.map((c) => c.split(";")[0]!)]
    .filter(Boolean)
    .join("; ");
  const entered = await app.inject({
    method: "POST",
    url: "/site/login",
    headers: {
      cookie: jar,
      origin,
      "content-type": "application/x-www-form-urlencoded",
    },
    payload: "account=alex",
  });
  const web = ([] as string[])
    .concat(entered.headers["set-cookie"] ?? [])
    .find((c) => c.includes("juniper_web="))!
    .split(";")[0]!;
  return `${jar}; ${web}`;
}
