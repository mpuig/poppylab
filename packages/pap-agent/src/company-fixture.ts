/**
 * TEST ONLY: a Company as discovery returns it, and a conversation's
 * connection to it, for the tests of the routes with several Companies.
 */
import type { Connection } from "./runtime";

/** A discovered Company with an OpenAPI description and Direct Sign-In. */
export function discovered(
  origin: string,
  name: string,
): NonNullable<Connection["company"]> {
  return {
    requestedUrl: origin,
    discoveryUrl: `${origin}/.well-known/poppy.json`,
    discoveredAt: new Date().toISOString(),
    trace: [],
    document: {
      protocol_version: "1.0",
      organization: { name, domain: new URL(origin).host },
      apis: [
        {
          type: "openapi",
          url: `${origin}/poppy/openapi.json`,
          description: `What ${name} offers to agents.`,
        },
      ],
      extensions: { operations: [{ version: "3" }] },
    },
    metadata: {
      issuer: origin,
      token_endpoint: `${origin}/oauth/token`,
      revocation_endpoint: `${origin}/oauth/revoke`,
      authorization_endpoint: `${origin}/oauth/authorize`,
      grant_types_supported: ["authorization_code", "refresh_token"],
      protected_resources: [origin],
      dpop_signing_alg_values_supported: ["ES256"],
    },
    profile: {
      version: "1.0",
      identifier: origin,
      issuer: origin,
      signIn: { direct: true, device: false },
      scopes: ["poppy:read", "poppy:write"],
      scopeDescriptions: {},
      scopeHints: {
        "poppy:read": { changes: "none", personal_data: true },
        "poppy:write": { changes: "irreversible", personal_data: true },
      },
      operations: true,
    },
  };
}

/**
 * A connection to it: signed out, or signed in with tokens that name the
 * Company (`refresh-<host>`, `access-<host>`), so a test can tell whose
 * token a request carried.
 */
export function connected(
  origin: string,
  name: string,
  scopes?: string,
): Connection {
  const host = new URL(origin).host;
  return {
    url: origin,
    user: "",
    visitor: "",
    ...(scopes
      ? {
          token: `access-${host}`,
          tokenType: "DPoP" as const,
          accountToken: `refresh-${host}`,
          scopes,
          tokenExpires: Date.now() + 3600000,
        }
      : {}),
    company: discovered(origin, name),
  };
}
