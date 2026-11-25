/** Fernwick Power & Light on Node for local development or a VPS. */
import { loadEnvFile } from "node:process";
try {
  loadEnvFile(".env.local");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
import { serve } from "@hono/node-server";
import { protocolRequest, vault } from "@poppy-lab/pap-client";
import { createCompany, emptyState } from "@poppy-lab/pap-company";
import { fernwick } from "./fernwick.ts";

const port = Number(process.env.PORT ?? 4500);
const domain = process.env.PUBLIC_DOMAIN ?? "fernwick.localhost";
const origin = process.env.PUBLIC_ORIGIN ?? `http://${domain}:${port}`;
const local = origin === "http://fernwick.localhost:4500";
const allowed = local ? ["http://localhost:3000"] : [];
const app = createCompany(fernwick, {
  origin,
  store: vault("fernwick", emptyState),
  ...(process.env.COMPANY_ISOLATION === "visitor"
    ? { isolation: "visitor" as const }
    : {}),
  fetchJson: (url) => protocolRequest(url, {}, allowed),
  ...(local
    ? { httpClients: ["http://localhost:3000/agent/client.json"] }
    : {}),
  ...(process.env.FERNWICK_PASSWORD_HASH
    ? { passwordHash: process.env.FERNWICK_PASSWORD_HASH }
    : {}),
});
serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? "127.0.0.1" });
console.log(`Fernwick Power & Light (fictional Poppy 1.0) on ${origin}`);
