import { describe, it, expect } from "vitest";
import {
  createIdentity,
  assertion,
  verifyAssertion,
  proof,
  verifyProof,
  ReplayCache,
} from "./session";

describe("Session cryptography", () => {
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
});
