import { afterEach, describe, it, expect, vi } from "vitest";
import {
  createIdentity,
  assertion,
  verifyAssertion,
  proof,
  verifyProof,
  ReplayCache,
} from "./session";

describe("Session cryptography", () => {
  afterEach(() => vi.useRealTimers());

  it("verifies assertions and rejects their replay", async () => {
    const key = await createIdentity();
    const cache = new ReplayCache();
    const jwt = await assertion(
      key.privateKey,
      "https://agent.example/client.json",
      "usr_random",
      "https://company.example",
    );
    await expect(
      verifyAssertion(
        jwt,
        key.publicKey,
        "https://agent.example/client.json",
        "usr_random",
        "https://company.example",
        cache,
      ),
    ).resolves.toMatchObject({ sub: "usr_random" });
    await expect(
      verifyAssertion(
        jwt,
        key.publicKey,
        "https://agent.example/client.json",
        "usr_random",
        "https://company.example",
        cache,
      ),
    ).rejects.toThrow();
  });

  it("rejects assertion replay during the post-expiry clockTolerance window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const key = await createIdentity();
    const cache = new ReplayCache();
    const jwt = await assertion(
      key.privateKey,
      "https://agent.example/client.json",
      "usr_random",
      "https://company.example",
    );
    await expect(
      verifyAssertion(
        jwt,
        key.publicKey,
        "https://agent.example/client.json",
        "usr_random",
        "https://company.example",
        cache,
      ),
    ).resolves.toMatchObject({ sub: "usr_random" });

    // Three seconds past exp (60s): still accepted by jwtVerify's 5s clockTolerance.
    vi.advanceTimersByTime(63_000);
    await expect(
      verifyAssertion(
        jwt,
        key.publicKey,
        "https://agent.example/client.json",
        "usr_random",
        "https://company.example",
        new ReplayCache(),
      ),
    ).resolves.toMatchObject({ sub: "usr_random" });
    await expect(
      verifyAssertion(
        jwt,
        key.publicKey,
        "https://agent.example/client.json",
        "usr_random",
        "https://company.example",
        cache,
      ),
    ).rejects.toThrow("Replayed JWT");
  });
  it("accepts PS384 and any lifetime up to 5 minutes, and refuses longer (§4.1)", async () => {
    const { generateKeyPair, exportJWK, SignJWT, importJWK } =
      await import("jose");
    const pair = await generateKeyPair("PS384", {
      modulusLength: 2048,
      extractable: true,
    });
    const rsa = {
      publicKey: { ...(await exportJWK(pair.publicKey)), kid: "rsa1" },
      privateKey: { ...(await exportJWK(pair.privateKey)), kid: "rsa1" },
    };
    const id = "https://agent.example/client.json";
    const ps = await assertion(
      rsa.privateKey,
      id,
      id,
      "https://issuer.example",
    );
    await expect(
      verifyAssertion(
        ps,
        rsa.publicKey,
        id,
        id,
        "https://issuer.example",
        new ReplayCache(),
      ),
    ).resolves.toBeTruthy();
    const ec = await createIdentity();
    const lasting = async (seconds: number, age: number) => {
      const now = Math.floor(Date.now() / 1000) - age;
      return new SignJWT({})
        .setProtectedHeader({ alg: "ES256", kid: ec.privateKey.kid })
        .setIssuer(id)
        .setSubject(id)
        .setAudience("https://issuer.example")
        .setIssuedAt(now)
        .setExpirationTime(now + seconds)
        .setJti(`j${seconds}${age}`)
        .sign(await importJWK(ec.privateKey, "ES256"));
    };
    const check = async (jwt: string) =>
      verifyAssertion(
        jwt,
        ec.publicKey,
        id,
        id,
        "https://issuer.example",
        new ReplayCache(),
      );
    // Five minutes, used after two: still valid for its lifetime.
    await expect(check(await lasting(300, 120))).resolves.toBeTruthy();
    await expect(check(await lasting(301, 0))).rejects.toThrow();
  });

  it("rejects another Company's audience", async () => {
    const key = await createIdentity();
    const jwt = await assertion(
      key.privateKey,
      "https://agent.example",
      "user",
      "https://company.example",
    );
    await expect(
      verifyAssertion(
        jwt,
        key.publicKey,
        "https://agent.example",
        "user",
        "https://other.example",
        new ReplayCache(),
      ),
    ).rejects.toThrow();
  });
  it("binds proofs to tokens, URLs, and methods", async () => {
    const key = await createIdentity();
    const url = "https://company.example/api/products";
    const jwt = await proof(key.privateKey, url, "GET", "fake-test-token");
    await expect(
      verifyProof(jwt, url, "GET", new ReplayCache(), "fake-test-token"),
    ).resolves.toBeTypeOf("string");
    await expect(
      verifyProof(jwt, url, "POST", new ReplayCache(), "fake-test-token"),
    ).rejects.toThrow();
    await expect(
      verifyProof(jwt, url, "GET", new ReplayCache(), "wrong-token"),
    ).rejects.toThrow();
    await expect(
      verifyProof(
        jwt,
        "https://company.example/api/other",
        "GET",
        new ReplayCache(),
        "fake-test-token",
      ),
    ).rejects.toThrow();
  });
  it("rejects a different DPoP binding and repeated proof", async () => {
    const key = await createIdentity();
    const url = "https://company.example/token";
    const cache = new ReplayCache();
    const jwt = await proof(key.privateKey, url, "POST");
    await expect(verifyProof(jwt, url, "POST", cache)).resolves.toBeTypeOf(
      "string",
    );
    await expect(verifyProof(jwt, url, "POST", cache)).rejects.toThrow();
    await expect(
      verifyProof(
        jwt,
        url,
        "POST",
        new ReplayCache(),
        undefined,
        "wrong-binding",
      ),
    ).rejects.toThrow();
  });

  it("rejects DPoP proof replay for future-skewed iat within clockTolerance", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { SignJWT, importJWK } = await import("jose");
    const key = await createIdentity();
    const url = "https://company.example/token";
    const cache = new ReplayCache();
    const now = Math.floor(Date.now() / 1000);
    // Four seconds ahead of server time: accepted within jose's 5s clockTolerance,
    // and remains valid under maxTokenAge (65s) + clockTolerance (5s) until t+74s.
    const jwt = await new SignJWT({ htm: "POST", htu: url })
      .setProtectedHeader({
        alg: "ES256",
        typ: "dpop+jwt",
        jwk: key.publicKey,
      })
      .setIssuedAt(now + 4)
      .setJti("skewed-proof-jti")
      .sign(await importJWK(key.privateKey, "ES256"));

    await expect(verifyProof(jwt, url, "POST", cache)).resolves.toBeTypeOf(
      "string",
    );

    // 72 seconds later: past now+70, still accepted by jwtVerify (72 - 4 = 68 <= 70).
    vi.advanceTimersByTime(72_000);
    await expect(
      verifyProof(jwt, url, "POST", new ReplayCache()),
    ).resolves.toBeTypeOf("string");
    await expect(verifyProof(jwt, url, "POST", cache)).rejects.toThrow(
      "Replayed JWT",
    );
  });
});

describe("Replay cache", () => {
  afterEach(() => vi.useRealTimers());
  const soon = () => Math.floor(Date.now() / 1000) + 60;

  it("keeps one client that fills it from refusing every other", () => {
    const cache = new ReplayCache();
    const flood = "https://flood.example/client.json";
    let taken = 0;
    for (let i = 0; i < 10000; i++)
      try {
        cache.accept(`session:${flood}:${i}`, soon(), flood);
        taken++;
      } catch {
        // Past its share: the rest of the flood is refused.
      }
    // A fifth of the cache, and no more.
    expect(taken).toBe(2000);
    const other = "https://agent.example/client.json";
    expect(() =>
      cache.accept(`session:${other}:a`, soon(), other),
    ).not.toThrow();
    // A copy is still refused, the flood's own and the other's.
    expect(() => cache.accept(`session:${other}:a`, soon(), other)).toThrow();
    expect(() => cache.accept(`session:${flood}:0`, soon(), flood)).toThrow();
  });

  it("gives a client its larger share when the deployment names one", () => {
    const trusted = "https://lab.example/client.json";
    const cache = new ReplayCache([], {
      total: 10,
      share: (owner) => (owner === trusted ? 0.5 : 0.2),
    });
    for (let i = 0; i < 5; i++) cache.accept(`t${i}`, soon(), trusted);
    expect(() => cache.accept("t5", soon(), trusted)).toThrow();
    cache.accept("o0", soon(), "https://other.example/client.json");
    cache.accept("o1", soon(), "https://other.example/client.json");
    expect(() =>
      cache.accept("o2", soon(), "https://other.example/client.json"),
    ).toThrow();
  });

  it("makes room when many clients fill it, and refuses none within its share", () => {
    const cache = new ReplayCache([], { total: 10 });
    const now = Math.floor(Date.now() / 1000);
    // Five clients at their share of two fill it; "c0-0" ends first.
    for (let c = 0; c < 5; c++)
      for (let i = 0; i < 2; i++)
        cache.accept(`c${c}-${i}`, now + 60 + c * 10 + i, `client ${c}`);
    expect(() => cache.accept("new-0", now + 60, "new client")).not.toThrow();
    // The entry nearest its end made room, and only it.
    expect(() => cache.accept("c0-0", now + 60, "client 0")).not.toThrow();
    expect(() => cache.accept("c4-1", now + 60, "client 4")).toThrow();
  });

  it("keeps an entry only until it ends, and frees its share then", () => {
    vi.useFakeTimers();
    const cache = new ReplayCache([], { total: 10 });
    const until = Math.floor(Date.now() / 1000) + 60;
    cache.accept("a", until, "client");
    cache.accept("b", until, "client");
    expect(() => cache.accept("c", until, "client")).toThrow();
    vi.advanceTimersByTime(61000);
    expect(() => cache.accept("a", until + 60, "client")).not.toThrow();
    expect(cache.snapshot()).toHaveLength(1);
  });

  it("survives a restart with its owners, and reads entries saved before them", () => {
    const cache = new ReplayCache([], { total: 10 });
    cache.accept("a", soon(), "client");
    cache.accept("b", soon(), "client");
    const restarted = new ReplayCache(cache.snapshot(), { total: 10 });
    expect(() => restarted.accept("a", soon(), "other")).toThrow();
    expect(() => restarted.accept("c", soon(), "client")).toThrow();
    // An entry from before owners were kept: its raw id and expiry.
    const old = new ReplayCache([["session:x:1", soon()]]);
    expect(() => old.accept("session:x:1", soon(), "x")).toThrow();
  });
});
