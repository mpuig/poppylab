/**
 * Lantern Noodle Bar on Node (development or a VPS). Same app as the
 * Cloudflare Worker; only the store and the network client differ.
 */
import { loadEnvFile } from "node:process";
try {
  loadEnvFile(".env.local");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
import { serve } from "@hono/node-server";
import { protocolRequest, vault } from "@poppy-lab/pap-client";
import { createCompany, emptyState } from "@poppy-lab/pap-company";
import { lantern } from "./lantern.ts";

const port = Number(process.env.PORT ?? 4200);
const domain = process.env.PUBLIC_DOMAIN ?? "noodles.localhost";
const origin = process.env.PUBLIC_ORIGIN ?? `http://${domain}:${port}`;
const local = origin === "http://noodles.localhost:4200";
// Development only: the local Poppy identity over plain HTTP.
const allowed = local ? ["http://localhost:3000"] : [];
const app = createCompany(lantern, {
  origin,
  domain,
  store: vault("lantern", emptyState),
  // Pinned DNS, private-address blocking, no redirects, bounded bodies.
  // A public VPS should set COMPANY_ISOLATION=visitor (see portable-runtime.md).
  ...(process.env.COMPANY_ISOLATION === "visitor"
    ? { isolation: "visitor" as const }
    : {}),
  fetchJson: (url) => protocolRequest(url, {}, allowed),
  ...(local
    ? { httpClients: ["http://localhost:3000/agent/client.json"] }
    : {}),
  ...(process.env.LANTERN_PASSWORD_HASH
    ? { passwordHash: process.env.LANTERN_PASSWORD_HASH }
    : {}),
});
serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? "127.0.0.1" });
console.log(`Lantern Noodle Bar (PAP 0.3) on ${origin}`);
