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
it("carries the Direct Conversation a direct_conversation_open names, only when it is an ID (1.0 §8.13)", async () => {
  let body: Record<string, unknown> = {
    error: "direct_conversation_open",
    conversation_id: "cnv_8f3Kd2-x",
  };
  const server = createServer((_req, res) => {
    res.writeHead(409, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  const refused = () =>
    protocolRequest(origin + "/poppy/conversations", { method: "POST" }, [
      origin,
    ]).then(
      () => {
        throw Error("expected error");
      },
      (e: ProtocolError) => e,
    );
  try {
    expect(await refused()).toMatchObject({
      status: 409,
      code: "direct_conversation_open",
      conversationId: "cnv_8f3Kd2-x",
    });
    // Company content: anything that isn't an ID (§8.2) is left out.
    for (const bad of [
      undefined,
      null,
      7,
      "",
      "cnv 8f3",
      "../cnv_8f3Kd2",
      "x".repeat(257),
      { id: "cnv_8f3Kd2" },
    ]) {
      body = { error: "direct_conversation_open", conversation_id: bad };
      const error = await refused();
      expect(error).toMatchObject({
        status: 409,
        code: "direct_conversation_open",
      });
      expect(error.conversationId).toBeUndefined();
    }
    // Only this error names one.
    body = { error: "conversation_closed", conversation_id: "cnv_8f3Kd2-x" };
    expect((await refused()).conversationId).toBeUndefined();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
it("carries a Company's own error code when it is a short token, and never its words", async () => {
  let status = 409,
    body: unknown = {
      error: "insufficient_funds",
      error_description: "Your balance is USD 12.00",
    },
    challenge = "";
  const server = createServer((_req, res) => {
    res.writeHead(status, {
      "content-type": "application/json",
      ...(challenge ? { "WWW-Authenticate": challenge } : {}),
    });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const refused = () =>
    protocolRequest(origin + "/payments", { method: "POST" }, [origin]).then(
      () => {
        throw Error("expected error");
      },
      (e: ProtocolError) => e,
    );
  try {
    const funds = await refused();
    // `code` still holds only the protocol's own codes: callers branch on it.
    expect(funds).toMatchObject({
      status: 409,
      code: undefined,
      companyCode: "insufficient_funds",
    });
    expect(JSON.stringify(funds) + funds.message).not.toContain("balance");
    // Other safe shapes: dots, colons, hyphens, digits, up to 64 characters.
    for (const token of [
      "account_changed",
      "bank.limit:daily-2",
      "x".repeat(64),
    ]) {
      body = { error: token };
      expect((await refused()).companyCode).toBe(token);
    }
    // Free text, or anything that isn't one short token, is left out.
    for (const bad of [
      "Your balance is too low",
      "insufficient funds",
      "",
      "x".repeat(65),
      "limit\nreached",
      "<b>no</b>",
      7,
      null,
      { code: "insufficient_funds" },
      ["insufficient_funds"],
    ]) {
      body = { error: bad, error_description: "insufficient_funds" };
      const error = await refused();
      expect(error).toMatchObject({ status: 409, code: undefined });
      expect(error.companyCode).toBeUndefined();
    }
    // Not JSON, or no `error` member: nothing to carry.
    for (const other of [
      "insufficient_funds",
      { code: "insufficient_funds" },
    ]) {
      body = other;
      expect((await refused()).companyCode).toBeUndefined();
    }
    // A protocol code is in both; a challenge's code is the protocol's only.
    body = { error: "request_id_conflict" };
    expect(await refused()).toMatchObject({
      code: "request_id_conflict",
      companyCode: "request_id_conflict",
    });
    status = 401;
    body = { error: "card_locked" };
    challenge = 'DPoP error="invalid_token"';
    expect(await refused()).toMatchObject({
      code: "invalid_token",
      companyCode: "card_locked",
    });
  } finally {
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

it("serializes and parses the Poppy-Approval dictionary (Operations v3, RFC 9651)", () => {
  const header = approvalHeader({
    operation_id: "op_1",
    revision: "1791-k3",
    approver: "user",
    approved_at: 1791487260,
    input_type: "tap",
    reference: "apr_01JD8ZK3Q9",
  });
  expect(header).toBe(
    'operation_id="op_1", revision="1791-k3", approver="user", approved_at=1791487260, input_type="tap", reference="apr_01JD8ZK3Q9"',
  );
  expect(parseApprovalHeader(header)).toEqual({
    operation_id: "op_1",
    revision: "1791-k3",
    approver: "user",
    approved_at: 1791487260,
    input_type: "tap",
    reference: "apr_01JD8ZK3Q9",
  });
  // Unknown members and parameters are ignored; strings may hold commas.
  expect(
    parseApprovalHeader(
      'approver="agent";x=1, operation_id="op_1", revision="r", future="a, b", flag, input_type="tap"',
    ),
  ).toEqual({ operation_id: "op_1", revision: "r", approver: "agent" });
  for (const bad of [
    undefined,
    "",
    "operation_id=op_1",
    'revision="r"',
    // No approver: not an approval.
    'operation_id="op_1", revision="r"',
    'operation_id="op_1", revision="r", approver="someone"',
    'operation_id="op_1", revision="r", approver="user",',
    'operation_id="op_1 , revision="r", approver="user"',
    "{}",
    "x".repeat(2000),
  ])
    expect(parseApprovalHeader(bad)).toBeUndefined();
  expect(() =>
    approvalHeader({ operation_id: 'op"1', revision: "r", approver: "user" }),
  ).toThrow();
  // input_type comes only with a user approval.
  expect(() =>
    approvalHeader({
      operation_id: "op_1",
      revision: "r",
      approver: "agent",
      input_type: "tap",
    }),
  ).toThrow();
});

it("keeps an API's own error body only when asked, and never for a Poppy or OAuth error (§7)", async () => {
  let status = 404,
    body: unknown = { code: "701", message: "Account not found" },
    challenge = "";
  const server = createServer((_req, res) => {
    res.writeHead(status, {
      "content-type": "application/json",
      ...(challenge ? { "WWW-Authenticate": challenge } : {}),
    });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const send = (errorBody?: boolean) =>
    protocolRequest(
      origin + "/x",
      {},
      [origin],
      undefined,
      errorBody ? { errorBody } : undefined,
    ).then(
      () => undefined,
      (e: unknown) => e as ProtocolError,
    );
  try {
    expect(await send(true)).toMatchObject({
      status: 404,
      code: undefined,
      body: { code: "701", message: "Account not found" },
    });
    // Not asked: the body is dropped, as before.
    expect((await send())?.body).toBeUndefined();
    // A Poppy error code, or any challenge, keeps the protocol's handling.
    status = 403;
    body = { error: "extension_required", extension: "poppylab.dev/fdx" };
    const declared = await send(true);
    expect(declared).toMatchObject({ code: "extension_required" });
    expect(declared?.body).toBeUndefined();
    status = 401;
    body = { code: "602", message: "Unauthorized" };
    challenge = 'DPoP error="invalid_token"';
    const token = await send(true);
    expect(token).toMatchObject({ code: "invalid_token" });
    expect(token?.body).toBeUndefined();
    challenge = 'DPoP realm="x"';
    const bare = await send(true);
    expect(bare).toMatchObject({ status: 401, code: undefined });
    expect(bare?.body).toBeUndefined();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("reads a document's bytes with binary, bounded, and still parses its errors as JSON", async () => {
  let status = 200,
    type = "application/pdf",
    payload: Buffer = Buffer.from("%PDF-1.4\n%\xe2\xe3\n", "latin1");
  const seen: Array<string | undefined> = [];
  const server = createServer((req, res) => {
    seen.push(req.headers.accept);
    res.writeHead(status, { "content-type": type });
    res.end(payload);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const send = (maxBytes = 64) =>
    protocolRequest(
      origin + "/doc",
      { headers: { Accept: "application/pdf" } },
      [origin],
      undefined,
      { binary: { maxBytes }, errorBody: true },
    ).then(
      (value) => value,
      (e: unknown) => e,
    );
  try {
    const read = (await send()) as { contentType: string; bytes: Uint8Array };
    expect(read.contentType).toBe("application/pdf");
    // Unparsed and undecoded: the high bytes are as sent.
    expect([...read.bytes]).toEqual([...payload]);
    expect(seen.at(-1)).toBe("application/pdf");
    // Over the cap: refused, never truncated.
    payload = Buffer.alloc(65, 0x25);
    expect(await send()).toBeInstanceOf(Error);
    // An error still comes as JSON, with its body when asked.
    status = 406;
    type = "application/json";
    payload = Buffer.from(JSON.stringify({ code: "not_acceptable" }));
    expect(await send()).toMatchObject({
      status: 406,
      body: { code: "not_acceptable" },
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("preserves ProtocolError status and headers when an error body exceeds the read limit", async () => {
  let calls = 0,
    status = 401,
    headers: Record<string, string> = {
      "content-type": "application/json",
      "Retry-After": "30",
      "DPoP-Nonce": "fresh-nonce",
      "WWW-Authenticate": 'DPoP error="use_dpop_nonce"',
    },
    payload = JSON.stringify({ error: "invalid_grant", pad: "x".repeat(5000) });
  const server = createServer((_req, res) => {
    calls++;
    res.writeHead(status, headers);
    res.end(payload);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const send = (errorBody = false) =>
    protocolRequest(
      origin + "/action",
      { method: "POST" },
      [origin],
      undefined,
      errorBody ? { errorBody } : undefined,
    ).then(
      () => {
        throw Error("expected error");
      },
      (e: unknown) => e,
    );
  try {
    const challenge = (await send(true)) as ProtocolError;
    expect(challenge).toBeInstanceOf(ProtocolError);
    expect(challenge).toMatchObject({
      status: 401,
      code: "use_dpop_nonce",
      nonce: "fresh-nonce",
    });
    expect(challenge.retryAt).toBeGreaterThan(Date.now());
    expect(challenge.body).toBeUndefined();
    expect(challenge.companyCode).toBeUndefined();
    expect(challenge.operation).toBeUndefined();
    expect(challenge.declined).toBeUndefined();
    expect(challenge.conversationId).toBeUndefined();

    // Retry-After from the oversized error response still enforces cooldown.
    const callsBeforeCooldown = calls;
    const blocked = (await send()) as ProtocolError;
    expect(blocked).toBeInstanceOf(ProtocolError);
    expect(blocked).toMatchObject({ status: 429, code: "rate_limited" });
    expect(calls).toBe(callsBeforeCooldown);

    // Advance past the 30s cooldown for the remaining checks on this origin.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);

    // Oversized 400 drops body-derived fields even when errorBody is requested.
    status = 400;
    headers = { "content-type": "application/json" };
    payload = JSON.stringify({
      error: "insufficient_funds",
      pad: "x".repeat(5000),
    });
    const badRequest = (await send(true)) as ProtocolError;
    expect(badRequest).toBeInstanceOf(ProtocolError);
    expect(badRequest.status).toBe(400);
    expect(badRequest.code).toBeUndefined();
    expect(badRequest.companyCode).toBeUndefined();
    expect(badRequest.body).toBeUndefined();

    // Oversized 403 (>64 KiB) also falls back to status/headers without body fields.
    status = 403;
    payload = JSON.stringify({
      error: "approval_required",
      operation: { id: "op_1" },
      pad: "x".repeat(70_000),
    });
    const forbidden = (await send(true)) as ProtocolError;
    expect(forbidden).toBeInstanceOf(ProtocolError);
    expect(forbidden.status).toBe(403);
    expect(forbidden.code).toBeUndefined();
    expect(forbidden.operation).toBeUndefined();
    expect(forbidden.companyCode).toBeUndefined();

    // Oversized 2xx responses still fail as plain Error("Document is too large").
    status = 200;
    payload = "x".repeat(512_001);
    const oversizedOk = (await send()) as Error;
    expect(oversizedOk).toBeInstanceOf(Error);
    expect(oversizedOk).not.toBeInstanceOf(ProtocolError);
    expect(oversizedOk.message).toBe("Document is too large");
  } finally {
    vi.restoreAllMocks();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("caps Retry-After durations to one hour for both delta-seconds and HTTP-dates", () => {
  const now = Date.parse("2030-01-01T00:00:00Z");
  const maxMs = 3_600_000;
  const deltaOrigin = "https://cap-delta.invalid";
  expect(recordCooldown(deltaOrigin, "86400", now)).toBe(now + maxMs);
  expect(() => checkCooldown(deltaOrigin, now + maxMs - 1)).toThrow(
    ProtocolError,
  );
  expect(() => checkCooldown(deltaOrigin, now + maxMs)).not.toThrow();

  const hugeOrigin = "https://cap-huge.invalid";
  expect(recordCooldown(hugeOrigin, "9".repeat(400), now)).toBe(now + maxMs);
  expect(() => checkCooldown(hugeOrigin, now + maxMs - 1)).toThrow(
    ProtocolError,
  );
  expect(() => checkCooldown(hugeOrigin, now + maxMs)).not.toThrow();

  const dateOrigin = "https://cap-date.invalid";
  expect(recordCooldown(dateOrigin, "Wed, 01 Jan 2040 00:00:00 GMT", now)).toBe(
    now + maxMs,
  );
  expect(() => checkCooldown(dateOrigin, now + maxMs - 1)).toThrow(
    ProtocolError,
  );
  expect(() => checkCooldown(dateOrigin, now + maxMs)).not.toThrow();
});

it("keeps cooldowns strictly per-origin when the 1,000-origin map overflows", async () => {
  vi.resetModules();
  const mod = await vi.importActual<typeof import("./protocol-error.js")>(
    "./protocol-error.js",
  );
  const store = {
    value: { until: 0, entries: [] as Array<[string, number]> },
    save: vi.fn(),
  };
  mod.configureRetryStore(store);

  // First, verify expired entries are purged before any active entry is evicted.
  const t0 = Date.parse("2030-01-01T00:00:00Z");
  for (let i = 0; i < 500; i++)
    mod.recordCooldown(`https://expired-${i}.invalid`, "10", t0);
  for (let i = 0; i < 500; i++)
    mod.recordCooldown(`https://active-${i}.invalid`, "60", t0);
  mod.recordCooldown("https://new-after-purge.invalid", "60", t0 + 15_000);
  expect(() =>
    mod.checkCooldown("https://active-0.invalid", t0 + 15_000),
  ).toThrow(mod.ProtocolError);
  expect(() =>
    mod.checkCooldown("https://new-after-purge.invalid", t0 + 15_000),
  ).toThrow(mod.ProtocolError);
  expect(() =>
    mod.checkCooldown("https://unrelated.invalid", t0 + 15_000),
  ).not.toThrow();
  expect(store.value.until).toBe(0);

  // Next, fill all 1,000 slots with active entries and overflow with a 1,001st origin.
  const t1 = t0 + 120_000;
  mod.recordCooldown("https://earliest.invalid", "5", t1);
  for (let i = 1; i < 1000; i++)
    mod.recordCooldown(`https://origin-${i}.invalid`, "60", t1);
  const recorded = mod.recordCooldown(
    "https://overflow-1001.invalid",
    "999999",
    t1,
  );
  expect(recorded).toBe(t1 + 3_600_000);
  // The earliest-expiring entry was evicted, active peers stay, and unrelated origins are never blocked.
  expect(() => mod.checkCooldown("https://earliest.invalid", t1)).not.toThrow();
  expect(() => mod.checkCooldown("https://origin-1.invalid", t1)).toThrow(
    mod.ProtocolError,
  );
  expect(() => mod.checkCooldown("https://origin-999.invalid", t1)).toThrow(
    mod.ProtocolError,
  );
  expect(() => mod.checkCooldown("https://overflow-1001.invalid", t1)).toThrow(
    mod.ProtocolError,
  );
  expect(() =>
    mod.checkCooldown("https://overflow-1001.invalid", t1 + 3_600_000),
  ).not.toThrow();
  expect(() =>
    mod.checkCooldown("https://unrelated.invalid", t1),
  ).not.toThrow();
  expect(store.value.until).toBe(0);
  expect(store.value.entries).toHaveLength(1000);
});

it("ignores legacy persisted global until and clamps legacy persisted entries", async () => {
  const now = Date.parse("2030-06-01T00:00:00Z");
  vi.spyOn(Date, "now").mockReturnValue(now);
  try {
    vi.resetModules();
    const mod = await vi.importActual<typeof import("./protocol-error.js")>(
      "./protocol-error.js",
    );
    const store = {
      value: {
        until: Number.MAX_SAFE_INTEGER,
        entries: [
          ["https://legacy-clamped.invalid", now + 86_400_000] as [
            string,
            number,
          ],
          ["https://legacy-expired.invalid", now - 1000] as [string, number],
        ],
      },
      save: vi.fn(),
    };
    mod.configureRetryStore(store);
    expect(store.value.until).toBe(0);
    // Unrelated origin is not blocked by the legacy global `until`.
    expect(() =>
      mod.checkCooldown("https://unrelated.invalid", now),
    ).not.toThrow();
    // Expired legacy entry is dropped; far-future legacy entry is clamped to 1 hour.
    expect(() =>
      mod.checkCooldown("https://legacy-expired.invalid", now),
    ).not.toThrow();
    expect(() =>
      mod.checkCooldown("https://legacy-clamped.invalid", now + 3_599_999),
    ).toThrow(mod.ProtocolError);
    expect(() =>
      mod.checkCooldown("https://legacy-clamped.invalid", now + 3_600_000),
    ).not.toThrow();
  } finally {
    vi.restoreAllMocks();
  }
});
