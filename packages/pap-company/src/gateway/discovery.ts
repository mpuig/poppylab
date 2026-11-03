/** Discovery documents (§3, RFC 8414, RFC 9728), the OpenAPI contract and health. */
import type { Hono } from "hono";
import type { Ctx } from "./context.ts";

export function mountDiscovery(app: Hono, ctx: Ctx) {
  const { def, deploy, origin, both } = ctx;
  // Metadata is public and changes only with a deployment.
  const cached = { "Cache-Control": "public, max-age=300" };
  app.get("/.well-known/poppy.json", (c) =>
    c.json(def.discovery(origin, deploy.domain), 200, cached),
  );
  app.get("/.well-known/oauth-protected-resource", (c) =>
    c.json({ resource: origin, authorization_servers: [origin] }, 200, cached),
  );
  app.get("/.well-known/oauth-authorization-server", (c) =>
    c.json(
      {
        issuer: origin,
        authorization_endpoint: `${origin}/oauth/authorize`,
        token_endpoint: `${origin}/oauth/token`,
        revocation_endpoint: `${origin}/oauth/revoke`,
        protected_resources: [origin],
        grant_types_supported: ["authorization_code", "refresh_token"],
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["private_key_jwt"],
        token_endpoint_auth_signing_alg_values_supported: ["ES256"],
        revocation_endpoint_auth_methods_supported: ["private_key_jwt"],
        authorization_response_iss_parameter_supported: true,
        client_id_metadata_document_supported: true,
        scopes_supported: both,
        dpop_signing_alg_values_supported: ["ES256"],
      },
      200,
      cached,
    ),
  );
  app.get("/openapi.json", (c) =>
    c.json({
      openapi: "3.1.0",
      info: { title: def.name, version: "1.0.0" },
      servers: [{ url: origin }],
      security: [{ dpop: [] }],
      components: {
        securitySchemes: { dpop: { type: "http", scheme: "DPoP" } },
      },
      paths: def.paths,
    }),
  );
  if (def.excludedTasks)
    app.get("/poppy/excluded-tasks.json", (c) =>
      c.json(def.excludedTasks!(origin), 200, cached),
    );
  const pageHeaders = def.pageHeaders ?? {};
  if (def.landing)
    app.get("/", (c) => c.html(def.landing!(origin), 200, pageHeaders));
  for (const [path, page] of Object.entries(def.pages ?? {}))
    app.get(path, (c) => c.html(page(origin), 200, pageHeaders));
  app.get("/health", (c) => c.json({ status: "ok", protocol: "0.3" }));
}
