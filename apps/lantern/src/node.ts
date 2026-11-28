/**
 * Lantern Noodle Bar on Node (development or a VPS). Same app as the
 * Cloudflare Worker; only the store and the network client differ.
 */
import { relative } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
try {
  loadEnvFile(".env.local");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { protocolRequest, vault } from "@poppy-lab/pap-client";
import { createCompany, emptyState } from "@poppy-lab/pap-company";
import { LOCAL_AGENT_ORIGIN, LOCAL_ORIGINS } from "@poppy-lab/pap-core";
import { lantern } from "./lantern.ts";

const port = Number(process.env.PORT ?? new URL(LOCAL_ORIGINS.lantern).port);
const domain = process.env.PUBLIC_DOMAIN ?? "noodles.localhost";
const origin = process.env.PUBLIC_ORIGIN ?? `http://${domain}:${port}`;
const local = origin === LOCAL_ORIGINS.lantern;
// Development only: the local Poppy identity over plain HTTP.
const allowed = local ? [LOCAL_AGENT_ORIGIN] : [];
const app = createCompany(lantern, {
  origin,
  store: vault("lantern", emptyState),
  // Pinned DNS, private-address blocking, no redirects, bounded bodies.
  // A public VPS should set COMPANY_ISOLATION=visitor (see portable-runtime.md).
  ...(process.env.COMPANY_ISOLATION === "visitor"
    ? { isolation: "visitor" as const }
    : {}),
  fetchJson: (url) => protocolRequest(url, {}, allowed),
  ...(local
    ? { httpClients: [`${LOCAL_AGENT_ORIGIN}/agent/client.json`] }
    : {}),
  ...(process.env.LANTERN_PASSWORD_HASH
    ? { passwordHash: process.env.LANTERN_PASSWORD_HASH }
    : {}),
});
// Product photos from ./public, then the Company itself.
const server = new Hono();
// The folder is found from this file, not from where the server was started.
const photos = relative(
  process.cwd(),
  fileURLToPath(new URL("../public", import.meta.url)),
);
server.use("/img/*", serveStatic({ root: photos }));
server.all("*", (c) => app.fetch(c.req.raw));
serve({ fetch: server.fetch, port, hostname: process.env.HOST ?? "127.0.0.1" });
console.log(`Lantern Noodle Bar (Poppy 1.0) on ${origin}`);
