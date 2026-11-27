import type { Connection } from "./runtime";

/** A signed-in (or signed-out) connection to a PAP Sandbox Company, for the runtime's tests. */
export function example(host = "food", signedIn = true): Connection {
  const origin = `https://${host}.papsandbox.com`;
  return {
    url: origin,
    user: "",
    visitor: "visitor-fixture",
    ...(signedIn
      ? {
          token: "access-1",
          tokenType: "DPoP" as const,
          accountToken: "refresh-1",
          scopes: "orders:read orders:write",
          tokenExpires: Date.now() + 3600000,
        }
      : {}),
    company: {
      requestedUrl: origin,
      discoveryUrl: origin + "/.well-known/poppy.json",
      discoveredAt: new Date().toISOString(),
      trace: [],
      document: {
        protocol_version: "1.0",
        organization: { name: host, domain: host + ".papsandbox.com" },
        apis: [
          {
            type: "openapi",
            url: origin + "/poppy/openapi.json",
            description: "Test",
          },
        ],
        extensions: { operations: [{ version: "3" }] },
      },
      metadata: {
        issuer: origin,
        token_endpoint: origin + "/oauth/token",
        revocation_endpoint: origin + "/oauth/revoke",
        authorization_endpoint: origin + "/oauth/authorize",
        grant_types_supported: ["authorization_code", "refresh_token"],
        protected_resources: [origin],
        dpop_signing_alg_values_supported: ["ES256"],
      },
      profile: {
        version: "1.0",
        identifier: origin,
        issuer: origin,
        signIn: { direct: true, device: false },
        scopes: ["orders:read", "orders:write"],
        scopeDescriptions: {},
        scopeHints: {},
        operations: true,
      },
    },
  };
}
export const headersOf = (call: unknown[]) =>
  (call[1] as RequestInit).headers as Record<string, string>;
