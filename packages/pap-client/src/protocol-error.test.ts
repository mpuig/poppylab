import { it, expect, vi } from "vitest";
import { createServer } from "node:http";
import { protocolRequest, ProtocolError } from "./index.js";
import {
  recordCooldown,
  checkCooldown,
  approvalHeader,
  parseApprovalHeader,
} from "./protocol-error.js";
it("preserves only allowlisted errors and enforces Retry-After before any new wire request", async () => {
  let calls = 0,
    status = 400,
    body = { error: "account_mismatch", error_description: "secret-token" },
    retry = "";
  const server = createServer((_req, res) => {
    calls++;
    res.writeHead(status, {
      "content-type": "application/json",
      ...(retry ? { "Retry-After": retry } : {}),
    });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  const send = () =>
    protocolRequest(origin + "/action", { method: "POST" }, [origin]);
  try {
    await expect(send()).rejects.toMatchObject({
      status: 400,
      code: "account_mismatch",
    });
    body = { error: "secret-token", error_description: "secret-token" };
    try {
      await send();
      throw Error("expected error");
    } catch (e) {
      expect(e).toBeInstanceOf(ProtocolError);
      expect((e as Error).message).not.toContain("secret-token");
    }
    status = 429;
    retry = "2";
    body = { error: "rate_limited", error_description: "secret-token" };
    await expect(send()).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
    });
    const before = calls;
    await expect(send()).rejects.toMatchObject({ status: 429 });
    expect(calls).toBe(before);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 2100);
    status = 200;
    retry = "";
    await expect(send()).resolves.toEqual(body);
    expect(calls).toBe(before + 1);
  } finally {
    vi.restoreAllMocks();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
it("honors HTTP-date, ignores malformed values and never shortens an existing cooldown", () => {
  const now = Date.parse("2030-01-01T00:00:00Z"),
    origin = "https://retry-tests.invalid";
  expect(recordCooldown(origin, "nonsense", now)).toBeUndefined();
  expect(recordCooldown(origin, "-10", now)).toBeUndefined();
  recordCooldown(origin, new Date(now + 60000).toUTCString(), now);
  recordCooldown(origin, "1", now);
  expect(() => checkCooldown(origin, now + 59999)).toThrow(ProtocolError);
  expect(() => checkCooldown(origin, now + 60000)).not.toThrow();
});

it("serializes and parses the Poppy-Approval dictionary (RFC 9651)", () => {
  const header = approvalHeader({ operation_id: "op_1", revision: "1791-k3" });
  expect(header).toBe('operation_id="op_1", revision="1791-k3"');
  expect(parseApprovalHeader(header)).toEqual({
    operation_id: "op_1",
    revision: "1791-k3",
  });
  expect(parseApprovalHeader(`${header}, future="x", flag`)).toEqual({
    operation_id: "op_1",
    revision: "1791-k3",
  });
  for (const bad of [
    undefined,
    "",
    "operation_id=op_1",
    'revision="r"',
    "{}",
    "x".repeat(2000),
  ])
    expect(parseApprovalHeader(bad)).toBeUndefined();
  expect(() =>
    approvalHeader({ operation_id: 'op"1', revision: "r" }),
  ).toThrow();
});
