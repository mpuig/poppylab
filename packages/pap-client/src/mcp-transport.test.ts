import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { once } from "node:events";
import { afterEach, expect, it } from "vitest";
import { mcpRequest, createIdentity, protocolRequest } from "./index";
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
async function endpoint(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
) {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("address");
  return `http://127.0.0.1:${address.port}`;
}
it.each([200, 204])(
  "accepts empty HTTP %s only when explicitly requested for revocation",
  async (status) => {
    const url = await endpoint((_req, res) => {
      res.writeHead(status);
      res.end();
    });
    await expect(
      protocolRequest(url, { method: "POST" }, [url]),
    ).rejects.toThrow();
    expect(
      await protocolRequest(url, { method: "POST" }, [url], undefined, {
        acceptEmpty: true,
      }),
    ).toBeNull();
  },
);
it("retries only one explicit nonce challenge with a fresh proof", async () => {
  let calls = 0;
  const key = await createIdentity();
  const url = await endpoint((req, res) => {
    calls++;
    if (calls === 1) {
      res.writeHead(401, {
        "Content-Type": "application/json",
        "DPoP-Nonce": "test-nonce",
      });
      res.end(JSON.stringify({ error: "use_dpop_nonce" }));
      return;
    }
    const claims = JSON.parse(
      Buffer.from(
        String(req.headers.dpop).split(".")[1]!,
        "base64url",
      ).toString(),
    );
    expect(claims.nonce).toBe("test-nonce");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
  });
  await mcpRequest(url, { method: "POST" }, [url], {
    key: key.privateKey,
    token: "fixture",
  });
  expect(calls).toBe(2);
});
it("does not retry a socket loss or loop on repeated nonce challenges", async () => {
  let calls = 0;
  const key = await createIdentity();
  const url = await endpoint((req, res) => {
    calls++;
    if (req.url === "/lost") {
      req.socket.destroy();
      return;
    }
    res.writeHead(401, {
      "Content-Type": "application/json",
      "DPoP-Nonce": "nonce",
    });
    res.end(JSON.stringify({ error: "use_dpop_nonce" }));
  });
  await expect(
    mcpRequest(url + "/lost", { method: "POST" }, [url], {
      key: key.privateKey,
    }),
  ).rejects.toThrow();
  expect(calls).toBe(1);
  calls = 0;
  await expect(
    mcpRequest(url, { method: "POST" }, [url], { key: key.privateKey }),
  ).rejects.toThrow();
  expect(calls).toBe(2);
});
it("handles JSON responses and session headers through the pinned transport", async () => {
  const url = await endpoint((req, res) => {
    expect(req.method).toBe("POST");
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Mcp-Session-Id", "example");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
  });
  expect(await mcpRequest(url, { method: "POST", body: "{}" }, [url])).toEqual({
    message: { jsonrpc: "2.0", id: 1, result: {} },
    sessionId: "example",
  });
});
it("finishes an SSE response without waiting for the server to close the stream", async () => {
  const url = await endpoint((_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.write('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n');
  });
  expect((await mcpRequest(url, { method: "POST" }, [url])).message).toEqual({
    jsonrpc: "2.0",
    id: 1,
    result: {},
  });
});
it("accepts a notification acknowledgement with no response body", async () => {
  const url = await endpoint((_req, res) => {
    res.writeHead(202);
    res.end();
  });
  expect((await mcpRequest(url, { method: "POST" }, [url])).message).toBeNull();
});
it("refuses redirects without forwarding the credential", async () => {
  let redirected = false;
  const url = await endpoint((req, res) => {
    if (req.url === "/other") {
      redirected = true;
      res.end();
      return;
    }
    res.writeHead(307, { Location: "/other" });
    res.end();
  });
  await expect(
    mcpRequest(
      url,
      { method: "POST", headers: { Authorization: "DPoP fictional" } },
      [url],
    ),
  ).rejects.toThrow("redirects");
  expect(redirected).toBe(false);
});
it("retains private destination protection", async () => {
  await expect(
    mcpRequest("http://127.0.0.1:9", { method: "POST" }),
  ).rejects.toThrow("HTTPS");
});
it("rejects oversized and non-MCP responses", async () => {
  const url = await endpoint((req, res) => {
    res.setHeader(
      "Content-Type",
      req.url === "/html" ? "text/html" : "application/json",
    );
    res.end(req.url === "/html" ? "<html/>" : "x".repeat(512001));
  });
  await expect(mcpRequest(url, { method: "POST" }, [url])).rejects.toThrow(
    "too large",
  );
  await expect(
    mcpRequest(url + "/html", { method: "POST" }, [url]),
  ).rejects.toThrow("content type");
});
