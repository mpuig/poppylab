/**
 * Juniper Market on Node (development or a VPS). Same app as the Cloudflare
 * Worker; only the store and the network client differ.
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
import { juniperCompany } from "./juniper.js";
import { dpopNonces } from "./dpop-nonce.js";

const port = Number(process.env.PORT ?? 4100);
const domain = process.env.PUBLIC_DOMAIN ?? "juniper.localhost";
const origin = process.env.PUBLIC_ORIGIN ?? `http://${domain}:${port}`;
const local = origin === "http://juniper.localhost:4100";
const passwordHash = process.env.JUNIPER_PASSWORD_HASH;
if (passwordHash && !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(passwordHash))
  throw new Error("Invalid JUNIPER_PASSWORD_HASH");
const app = createCompany(juniperCompany({ portal: local }), {
  origin,
  domain,
  store: vault("juniper", emptyState),
  // Pinned DNS, private-address blocking, no redirects, bounded bodies.
  // A public VPS should set COMPANY_ISOLATION=visitor (see portable-runtime.md).
  ...(process.env.COMPANY_ISOLATION === "visitor"
    ? { isolation: "visitor" as const }
    : {}),
  fetchJson: (url) =>
    protocolRequest(url, {}, local ? ["http://localhost:3000"] : []),
  ...(local
    ? { httpClients: ["http://localhost:3000/agent/client.json"] }
    : {}),
  ...(passwordHash ? { passwordHash } : {}),
  ...(process.env.JUNIPER_DPOP_NONCE === "required"
    ? { dpopNonces: dpopNonces() }
    : {}),
});
serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? "127.0.0.1" });
console.log(`Juniper Market (PAP 0.3) on ${origin}`);
