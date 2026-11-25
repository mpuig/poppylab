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
import { bankPersona, harborline } from "./harborline.ts";

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
  // The raw bytes too, for a binary body such as a statement PDF.
  const bytes = new Uint8Array(await response.arrayBuffer());
  const body = new TextDecoder().decode(bytes);
  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
    bytes,
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
  type SignOptions = {
    allowOffline?: boolean;
    allowChanges?: boolean;
    /** Accounts ticked for the FDX-shaped API (default: all the persona's). */
    fdxAccounts?: string[];
  };
  const verifier = "v".repeat(64);
  /** The consent page and its form post; the post's response. */
  const authorize = async (
    account: "elena" | "robin",
    requested: string[],
    options: SignOptions = {},
  ) => {
    const page = await inject(
      `/oauth/authorize?${new URLSearchParams({ client_id: client, redirect_uri: redirect, response_type: "code", state: "s".repeat(32), scope: requested.join(" "), code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") })}`,
    );
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("Harborline Bank");
    expect(page.body).toContain("No real account exists");
    // With visitor isolation a browser cookie comes first.
    const cookie = String(page.headers["set-cookie"])
      .split(/,\s*/)
      .find((value) => value.includes("pap_consent_"))!
      .split(";")[0]!;
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
    if (requested.some((scope) => scope.startsWith("fdx:")))
      for (const id of options.fdxAccounts ??
        bankPersona(account)!.accounts.map((item) => item.id))
        payload[`fdx_account_${id}`] = "yes";
    return {
      page,
      consent: await inject({
        method: "POST",
        url: "/oauth/authorize",
        headers: { cookie, origin },
        payload,
      }),
    };
  };
  const sign = async (
    account: "elena" | "robin",
    requested: string[],
    options: SignOptions = {},
  ) => {
    const { consent } = await authorize(account, requested, options);
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
      consent_id?: string;
    };
  };
  const call = async (
    access: string,
    method: "GET" | "POST" | "PUT",
    url: string,
    payload?: Record<string, unknown>,
    approval?: {
      operation_id: string;
      revision: string;
      approver?: "user" | "agent";
    },
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
                operation_id: approval.operation_id,
                revision: approval.revision,
                approver: approval.approver ?? "user",
                approved_at: Math.floor(Date.now() / 1000),
                // Operations v3 §6: input_type only with a user approval.
                ...(approval.approver === "agent" ? {} : { input_type: "tap" }),
              }),
            }
          : {}),
      },
      ...(payload ? { payload } : {}),
    });
  return { sign, authorize, call, token, keys, dpop, sessionKey };
}

/**
 * A PDF's structure, checked from its bytes: header, objects at the offsets
 * the cross-reference table gives, stream lengths, the trailer and the page
 * tree. Returns the page count and the text the content streams show.
 */
export function readPdf(bytes: Uint8Array) {
  const file = String.fromCharCode(...bytes);
  expect(file.startsWith("%PDF-1.4\n")).toBe(true);
  expect(file.endsWith("%%EOF\n")).toBe(true);
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(file)![1]);
  expect(file.slice(start, start + 5)).toBe("xref\n");
  const [, first, size] = /^xref\n(\d+) (\d+)\n/.exec(file.slice(start))!;
  expect(first).toBe("0");
  const table = file
    .slice(start)
    .split("\n")
    .slice(2, 2 + Number(size));
  expect(table[0]).toBe("0000000000 65535 f ");
  table.slice(1).forEach((entry, i) => {
    // Each entry is exactly 20 bytes with its end of line.
    expect(entry).toMatch(/^\d{10} 00000 n $/);
    const offset = Number(entry.slice(0, 10));
    expect(file.slice(offset).startsWith(`${i + 1} 0 obj\n`)).toBe(true);
  });
  const trailer =
    /trailer\n<< \/Size (\d+) \/Root 1 0 R \/Info (\d+) 0 R >>/.exec(file)!;
  expect(Number(trailer[1])).toBe(Number(size));
  for (const match of file.matchAll(
    /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g,
  ))
    expect(match[2]!.length).toBe(Number(match[1]));
  const pages = [...file.matchAll(/\/Type \/Page /g)].length;
  expect(
    Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(file)![1]),
  ).toBe(pages);
  const shown = [...file.matchAll(/\((.*?)(?<!\\)\) Tj/g)].map((m) =>
    m[1]!
      .replace(/\\([()\\])/g, "$1")
      .replace(/\\(\d{3})/g, (_, octal: string) =>
        String.fromCharCode(parseInt(octal, 8)),
      ),
  );
  return { pages, text: shown.join("\n"), size: bytes.byteLength };
}
