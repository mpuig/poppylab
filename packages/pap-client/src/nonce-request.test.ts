import { it, expect } from "vitest";
import { createServer } from "node:http";
import { decodeJwt } from "jose";
import {
  createIdentity,
  proof,
  assertion,
  protocolRequest,
  verifyProof,
  ReplayCache,
} from "./index.js";
it.each([
  "success",
  "api",
  "missing",
  "oversized",
  "loop",
  "uncertain",
  "wrong-code",
])("nonce transport: %s", async (mode) => {
  const keys = await createIdentity();
  let calls = 0,
    origin = "",
    commits = 0;
  const proofs: string[] = [],
    assertions: string[] = [];
  const server = createServer(async (req, res) => {
    calls++;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = new URLSearchParams(Buffer.concat(chunks).toString());
    assertions.push(body.get("client_assertion") ?? "");
    proofs.push(String(req.headers.dpop));
    if (mode === "uncertain") {
      commits++;
      res.destroy();
      return;
    }
    if (calls === 1 || mode === "loop" || mode === "wrong-code") {
      res.writeHead(mode === "api" ? 401 : 400, {
        "Content-Type": "application/json",
        ...(mode === "missing"
          ? {}
          : {
              "DPoP-Nonce":
                mode === "oversized" ? "n".repeat(257) : "server-nonce",
            }),
        ...(mode === "api"
          ? { "WWW-Authenticate": 'DPoP error="use_dpop_nonce"' }
          : {}),
      });
      res.end(
        mode === "api"
          ? ""
          : JSON.stringify({
              error: mode === "wrong-code" ? "invalid_grant" : "use_dpop_nonce",
            }),
      );
      return;
    }
    try {
      await verifyProof(
        String(req.headers.dpop),
        origin + "/token",
        "POST",
        new ReplayCache(),
        undefined,
        undefined,
        (nonce) => {
          if (nonce !== "server-nonce") throw Error("nonce");
        },
      );
      commits++;
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400);
      res.end("{}");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const send = async () =>
    protocolRequest(
      origin + "/token",
      {
        method: "POST",
        headers: {
          DPoP: await proof(keys.privateKey, origin + "/token", "POST"),
        },
        body: new URLSearchParams({
          client_assertion: await assertion(
            keys.privateKey,
            "client",
            "client",
            origin,
          ),
          grant_type: "test",
        }).toString(),
      },
      [origin],
      {
        key: keys.privateKey,
        assertions: {
          key: keys.privateKey,
          client: "client",
          issuer: origin,
        },
      },
    );
  try {
    if (mode === "success" || mode === "api") {
      await expect(send()).resolves.toEqual({ ok: true });
      expect(calls).toBe(2);
      expect(commits).toBe(1);
      expect(decodeJwt(proofs[1]!).nonce).toBe("server-nonce");
      expect(assertions[1]).not.toBe(assertions[0]);
      expect(decodeJwt(proofs[1]!).jti).not.toBe(decodeJwt(proofs[0]!).jti);
    } else {
      await expect(send()).rejects.toThrow();
      expect(calls).toBe(mode === "loop" ? 2 : 1);
      expect(commits).toBe(mode === "uncertain" ? 1 : 0);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
it("makes a fresh jti and carries the nonce only in the requested proof", async () => {
  const keys = await createIdentity();
  const a = decodeJwt(
    await proof(
      keys.privateKey,
      "https://one.example/token",
      "POST",
      undefined,
      "nonce",
    ),
  );
  const b = decodeJwt(
    await proof(keys.privateKey, "https://two.example/token", "POST"),
  );
  expect(b.nonce).toBeUndefined();
  expect(a.jti).not.toBe(b.jti);
  expect(
    await assertion(keys.privateKey, "client", "client", "issuer"),
  ).toBeTruthy();
});
