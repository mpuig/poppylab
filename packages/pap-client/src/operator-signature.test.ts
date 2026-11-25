import { describe, expect, it } from "vitest";
import {
  deriveOperatorKey,
  operatorDirectory,
  operatorDirectoryResponse,
  operatorSignatureHeaders,
  signatureBase,
  signatureParams,
  signEd25519,
  verifyEd25519,
} from "./operator-signature";

// RFC 9421 Appendix B.1.4 (test-key-ed25519) and B.2.6.
const rfcKey = {
  kty: "OKP",
  crv: "Ed25519",
  d: "n4Ni-HpISpVObnQMW0wOhCKROaIKqKtW_2ZYb2p9KcU",
  x: "JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs",
};

describe("operator signatures (§5.3, RFC 9421, Web Bot Auth)", () => {
  it("reproduces the RFC 9421 B.2.6 Ed25519 signature byte for byte", async () => {
    const ids = [
      '"date"',
      '"@method"',
      '"@path"',
      '"@authority"',
      '"content-type"',
      '"content-length"',
    ];
    const params = signatureParams(ids, [
      ["created", 1618884473],
      ["keyid", "test-key-ed25519"],
    ]);
    const base = signatureBase(
      [
        { id: ids[0]!, value: "Tue, 20 Apr 2021 02:07:55 GMT" },
        { id: ids[1]!, value: "POST" },
        { id: ids[2]!, value: "/foo" },
        { id: ids[3]!, value: "example.com" },
        { id: ids[4]!, value: "application/json" },
        { id: ids[5]!, value: "18" },
      ],
      params,
    );
    expect(await signEd25519(rfcKey, base)).toBe(
      "wqcAqbmYJ2ji2glfAMaRy4gruYYnx2nEFN2HN6jrnDnQCK1u02Gb04v9EDgwUPiu4A0w6vuQv5lIp5WPpBKRCw==",
    );
  });

  it("signs a request covering the Session header and Authorization, verifiable from the directory key", async () => {
    const key = await deriveOperatorKey(new TextEncoder().encode("seed"));
    const agent = operatorDirectory("https://poppylab.dev/anything");
    expect(agent).toBe(
      "https://poppylab.dev/.well-known/http-message-signatures-directory",
    );
    const h = await operatorSignatureHeaders({
      key,
      agent,
      method: "post",
      url: "https://Food-Demo.PoppyLab.dev/poppy/conversations?wait=10",
      poppySession: "eyJhbGciOi.session.jwt",
      authorization: "DPoP token-1",
      now: 1793800000000,
      nonce: "n0nce",
    });
    expect(h["Signature-Agent"]).toBe(`sig1="${agent}"`);
    const params = `("@authority" "@method" "@path" "signature-agent";key="sig1" "poppy-session" "authorization");created=1793800000;expires=1793800300;keyid="${key.keyid}";alg="ed25519";nonce="n0nce";tag="web-bot-auth"`;
    expect(h["Signature-Input"]).toBe(`sig1=${params}`);
    // A verifier rebuilds the base from the request and checks it.
    const base = [
      '"@authority": food-demo.poppylab.dev',
      '"@method": POST',
      '"@path": /poppy/conversations',
      `"signature-agent";key="sig1": "${agent}"`,
      '"poppy-session": eyJhbGciOi.session.jwt',
      '"authorization": DPoP token-1',
      `"@signature-params": ${params}`,
    ].join("\n");
    const sig = /^sig1=:([A-Za-z0-9+/=]+):$/.exec(h.Signature)![1]!;
    expect(await verifyEd25519(key.publicKey, base, sig)).toBe(true);
    expect(
      await verifyEd25519(key.publicKey, base.replace("POST", "GET"), sig),
    ).toBe(false);
    // Signed out: no Authorization component.
    const out = await operatorSignatureHeaders({
      key,
      agent,
      method: "GET",
      url: "https://food-demo.poppylab.dev/poppy/tasks",
      poppySession: "jwt",
    });
    expect(out["Signature-Input"]).not.toContain('"authorization"');
  });

  it("derives a stable key apart from other keys, and signs the directory response", async () => {
    const a = await deriveOperatorKey(new TextEncoder().encode("seed"));
    const b = await deriveOperatorKey(new TextEncoder().encode("seed"));
    const c = await deriveOperatorKey(new TextEncoder().encode("other"));
    expect(a.keyid).toBe(b.keyid);
    expect(a.keyid).not.toBe(c.keyid);
    expect(a.publicKey).not.toHaveProperty("d");
    expect(a.publicKey.kid).toBe(a.keyid);
    const r = await operatorDirectoryResponse({
      keys: [a],
      authority: "poppylab.dev",
      now: 1793800000000,
    });
    expect(JSON.parse(r.body)).toEqual({ keys: [a.publicKey] });
    expect(r.headers["Content-Type"]).toBe(
      "application/http-message-signatures-directory+json",
    );
    const params = /^sig1=(.*)$/.exec(r.headers["Signature-Input"])![1]!;
    expect(params).toContain('tag="http-message-signatures-directory"');
    const base = [
      '"@authority";req: poppylab.dev',
      `"content-digest": ${r.headers["Content-Digest"]}`,
      `"@signature-params": ${params}`,
    ].join("\n");
    const sig = /^sig1=:(.*):$/.exec(r.headers.Signature)![1]!;
    expect(await verifyEd25519(a.publicKey, base, sig)).toBe(true);
    const digest = Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(r.body)),
    ).toString("base64");
    expect(r.headers["Content-Digest"]).toBe(`sha-256=:${digest}:`);
  });
});
