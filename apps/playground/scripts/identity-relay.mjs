// Development-only public surface. Tunnel this listener, NEVER the playground port.
import { createServer } from "node:http";
import { URL } from "node:url";
import { Buffer } from "node:buffer";
import process from "node:process";
import console from "node:console";
export function createRelay({ fetchPublic = globalThis.fetch } = {}) {
  let count = 0,
    window = Date.now();
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'",
    );
    if (Date.now() - window > 60000) {
      window = Date.now();
      count = 0;
    }
    if (++count > 120) {
      res.writeHead(429).end();
      return;
    }
    if (req.method !== "GET" || (req.url?.length ?? 0) > 8192) {
      res.writeHead(405).end();
      return;
    }
    const url = new URL(req.url ?? "/", "http://relay.invalid");
    if (url.pathname === "/api/account/callback") {
      const state = url.searchParams.get("state"),
        issuer = url.searchParams.get("iss");
      if (
        !state ||
        !/^[A-Za-z0-9_-]{32}$/.test(state) ||
        ![
          "https://food.papsandbox.com",
          "https://flowers.papsandbox.com",
          "https://stays.papsandbox.com",
        ].includes(issuer) ||
        [...url.searchParams].some(
          ([k, v]) =>
            !["state", "iss", "code", "error"].includes(k) || v.length > 2048,
        ) ||
        [...url.searchParams.keys()].some(
          (k) => url.searchParams.getAll(k).length !== 1,
        ) ||
        (!url.searchParams.has("code") && !url.searchParams.has("error"))
      ) {
        res.writeHead(400).end();
        return;
      }
      // Fixed destination: no Host/Forwarded header or caller-controlled redirect URL.
      res
        .writeHead(302, {
          Location: "http://localhost:3000/api/account/callback" + url.search,
        })
        .end();
      return;
    }
    if (
      !["/agent/client.json", "/agent/jwks.json"].includes(url.pathname) ||
      url.search
    ) {
      res.writeHead(404).end();
      return;
    }
    try {
      const response = await fetchPublic(
        "http://localhost:3000" + url.pathname,
        {
          redirect: "error",
          signal: globalThis.AbortSignal.timeout(3000),
          headers: { "x-pap-public-identity": "1" },
        },
      );
      if (!response.ok) throw Error();
      const reader = response.body.getReader();
      let text = "",
        size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 16384) throw Error();
          text += Buffer.from(value).toString("utf8");
        }
      } finally {
        await reader.cancel();
      }
      const data = JSON.parse(text);
      if (url.pathname.endsWith("jwks.json")) {
        if (
          !Array.isArray(data.keys) ||
          data.keys.length > 4 ||
          data.keys.some((k) =>
            Object.keys(k).some(
              (n) =>
                ![
                  "kty",
                  "crv",
                  "x",
                  "y",
                  "kid",
                  "use",
                  "alg",
                  "key_ops",
                ].includes(n),
            ),
          )
        )
          throw Error();
      } else {
        if (
          !data.client_id?.startsWith("https://") ||
          Object.keys(data).some(
            (k) =>
              ![
                "client_id",
                "client_name",
                "jwks_uri",
                "redirect_uris",
                "extensions",
                "token_endpoint_auth_method",
              ].includes(k),
          )
        )
          throw Error();
      }
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(data));
    } catch {
      res
        .writeHead(503, { "Content-Type": "text/plain" })
        .end(
          "Public identity unavailable. Configure AGENT_PUBLIC_ORIGIN and restart the local playground.",
        );
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  server.maxConnections = 16;
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file://").href
) {
  const port = Number(process.env.IDENTITY_RELAY_PORT ?? 4101);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error("Invalid relay port");
  createRelay().listen(port, "127.0.0.1", () =>
    console.log(
      `Identity-only relay listening on 127.0.0.1:${port}. No playground APIs are exposed.`,
    ),
  );
}
