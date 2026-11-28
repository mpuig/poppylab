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
import { LOCAL_AGENT_ORIGIN, LOCAL_ORIGINS } from "@poppy-lab/pap-core";
import { northwind } from "./northwind.ts";

const port = Number(process.env.PORT ?? new URL(LOCAL_ORIGINS.northwind).port);
const domain = process.env.PUBLIC_DOMAIN ?? "northwind.localhost";
const origin = process.env.PUBLIC_ORIGIN ?? `http://${domain}:${port}`;
const local = origin === LOCAL_ORIGINS.northwind;
const allowed = local ? [LOCAL_AGENT_ORIGIN] : [];
const app = createCompany(northwind, {
  origin,
  store: vault("northwind", emptyState),
  ...(process.env.COMPANY_ISOLATION === "visitor"
    ? { isolation: "visitor" as const }
    : {}),
  fetchJson: (url) => protocolRequest(url, {}, allowed),
  ...(local
    ? { httpClients: [`${LOCAL_AGENT_ORIGIN}/agent/client.json`] }
    : {}),
  ...(process.env.NORTHWIND_PASSWORD_HASH
    ? { passwordHash: process.env.NORTHWIND_PASSWORD_HASH }
    : {}),
});
serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? "127.0.0.1" });
console.log(`Northwind Air (Poppy 1.0) on ${origin}`);
