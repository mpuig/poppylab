/**
 * TEST ONLY. A small Company on the gateway, with a Company Agent, and a
 * Personal Agent's keys to call it: form posts to the OAuth endpoints and
 * signed-out conversation requests.
 */
import {
  assertion,
  createIdentity,
  createSessionKey,
  newSessionId,
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

export async function setup(deploy: Partial<Deployment> = {}) {
  const keys = await createIdentity();
  const store = memoryStore();
  /** A test sets `wait` to hold metadata fetches, so requests interleave. */
  const metadata: { wait?: () => Promise<void> } = {};
  const app = createCompany(company, {
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
  });
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
  return { app, store, metadata, credentials, form, post };
}
