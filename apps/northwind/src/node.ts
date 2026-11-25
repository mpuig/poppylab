/** Northwind Air on Node for local development or a VPS. */
import { loadEnvFile } from "node:process";
try {
  loadEnvFile(".env.local");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
import { serve } from "@hono/node-server";
import { protocolRequest, vault } from "@poppy-lab/pap-client";
import { createCompany, emptyState } from "@poppy-lab/pap-company";
import { northwind } from "./northwind.ts";

const port = Number(process.env.PORT ?? 4400);
const domain = process.env.PUBLIC_DOMAIN ?? "northwind.localhost";
const origin = process.env.PUBLIC_ORIGIN ?? `http://${domain}:${port}`;
const local = origin === "http://northwind.localhost:4400";
const allowed = local ? ["http://localhost:3000"] : [];
const app = createCompany(northwind, {
  origin,
  store: vault("northwind", emptyState),
  ...(process.env.COMPANY_ISOLATION === "visitor"
    ? { isolation: "visitor" as const }
    : {}),
  fetchJson: (url) => protocolRequest(url, {}, allowed),
  ...(local
    ? { httpClients: ["http://localhost:3000/agent/client.json"] }
    : {}),
  ...(process.env.NORTHWIND_PASSWORD_HASH
    ? { passwordHash: process.env.NORTHWIND_PASSWORD_HASH }
    : {}),
});
serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? "127.0.0.1" });
console.log(`Northwind Air (Poppy 1.0) on ${origin}`);
