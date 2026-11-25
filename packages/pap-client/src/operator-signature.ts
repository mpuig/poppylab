/**
 * PAP 1.0 §5.3, operator signatures: an HTTP Message Signature (RFC 9421)
 * in the Web Bot Auth profile (draft-ietf-webbotauth-httpsig-protocol-01),
 * so bot defenses in front of a Company can recognize the operator. It
 * covers `poppy-session`, and `authorization` when present, and is signed
 * with an Ed25519 key kept apart from the delegated Session keys. It adds
 * nothing to authorization: Companies still verify the Session JWT.
 *
 * Web Crypto only, so it runs in Node and in Cloudflare Workers.
 */
import { calculateJwkThumbprint, type JWK } from "jose";

/** One covered component: its serialized identifier and its value. */
export type SignedComponent = { id: string; value: string };
type Param = [name: string, value: string | number];

const b64 = (bytes: ArrayBuffer | Uint8Array) =>
  Buffer.from(
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
  ).toString("base64");
const sfString = (v: string) => {
  if (!/^[\x20-\x7e]*$/.test(v)) throw new Error("Not an sf-string");
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
};

/** RFC 9421 §2.3: the inner list of identifiers and its parameters, in order. */
export function signatureParams(ids: string[], params: Param[]) {
  return `(${ids.join(" ")})${params
    .map(([k, v]) => `;${k}=${typeof v === "number" ? v : sfString(v)}`)
    .join("")}`;
}
/** RFC 9421 §2.5: the signature base. */
export function signatureBase(components: SignedComponent[], params: string) {
  for (const c of components)
    if (/[\r\n]/.test(c.value)) throw new Error("Invalid component value");
  return [
    ...components.map((c) => `${c.id}: ${c.value.trim()}`),
    `"@signature-params": ${params}`,
  ].join("\n");
}

const ed25519 = { name: "Ed25519" } as const;
/** Signs a signature base with an Ed25519 private JWK (RFC 9421 §3.3.6). */
export async function signEd25519(privateJwk: JWK, base: string) {
  const key = await crypto.subtle.importKey(
    "jwk",
    privateJwk as JsonWebKey,
    ed25519,
    false,
    ["sign"],
  );
  return b64(
    await crypto.subtle.sign(ed25519, key, new TextEncoder().encode(base)),
  );
}
/** Verifies a base64 Ed25519 signature with a public JWK. */
export async function verifyEd25519(
  publicJwk: JWK,
  base: string,
  signature: string,
) {
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x } as JsonWebKey,
    ed25519,
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    ed25519,
    key,
    Buffer.from(signature, "base64"),
    new TextEncoder().encode(base),
  );
}

export type OperatorKey = { privateKey: JWK; publicKey: JWK; keyid: string };

/**
 * An Ed25519 operator key derived from a secret seed (HKDF-SHA-256), so a
 * deployment needs no extra secret and the key is stable across restarts.
 */
export async function deriveOperatorKey(
  secret: Uint8Array,
): Promise<OperatorKey> {
  const ikm = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(secret),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const seed = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new TextEncoder().encode("poppy-lab operator key"),
        info: new TextEncoder().encode("web-bot-auth ed25519 v1"),
      },
      ikm,
      256,
    ),
  );
  // PKCS #8 wrapping of a raw Ed25519 seed (RFC 8410 §7).
  const pkcs8 = new Uint8Array([
    ...[0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70],
    ...[0x04, 0x22, 0x04, 0x20],
    ...seed,
  ]);
  const key = await crypto.subtle.importKey("pkcs8", pkcs8, ed25519, true, [
    "sign",
  ]);
  const jwk = (await crypto.subtle.exportKey("jwk", key)) as JWK;
  const publicKey = { kty: "OKP", crv: "Ed25519", x: jwk.x! } as JWK;
  const keyid = await calculateJwkThumbprint(publicKey);
  return {
    privateKey: { kty: "OKP", crv: "Ed25519", x: jwk.x!, d: jwk.d! } as JWK,
    publicKey: { ...publicKey, kid: keyid, use: "sig" },
    keyid,
  };
}

const LABEL = "sig1";
/** The Web Bot Auth key directory URL for an operator origin. */
export const operatorDirectory = (origin: string) =>
  `${new URL(origin).origin}/.well-known/http-message-signatures-directory`;

/**
 * Signature, Signature-Input and Signature-Agent for one request. Covers
 * @authority, @method, @path, the Signature-Agent member, Poppy-Session and,
 * when present, Authorization; valid for five minutes, with a nonce.
 */
export async function operatorSignatureHeaders(input: {
  key: OperatorKey;
  /** The key directory URL (Signature-Agent). */
  agent: string;
  method: string;
  url: string;
  poppySession: string;
  authorization?: string;
  now?: number;
  nonce?: string;
}) {
  const url = new URL(input.url);
  const agent = sfString(input.agent);
  const components: SignedComponent[] = [
    { id: '"@authority"', value: url.host.toLowerCase() },
    { id: '"@method"', value: input.method.toUpperCase() },
    { id: '"@path"', value: url.pathname || "/" },
    { id: `"signature-agent";key="${LABEL}"`, value: agent },
    { id: '"poppy-session"', value: input.poppySession },
    ...(input.authorization
      ? [{ id: '"authorization"', value: input.authorization }]
      : []),
  ];
  const created = Math.floor((input.now ?? Date.now()) / 1000);
  const params = signatureParams(
    components.map((c) => c.id),
    [
      ["created", created],
      ["expires", created + 300],
      ["keyid", input.key.keyid],
      ["alg", "ed25519"],
      [
        "nonce",
        input.nonce ??
          Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString(
            "base64url",
          ),
      ],
      ["tag", "web-bot-auth"],
    ],
  );
  const signature = await signEd25519(
    input.key.privateKey,
    signatureBase(components, params),
  );
  return {
    "Signature-Agent": `${LABEL}=${agent}`,
    "Signature-Input": `${LABEL}=${params}`,
    Signature: `${LABEL}=:${signature}:`,
  };
}

/**
 * The key directory response (Web Bot Auth §5.5, Appendix B.1): the JWKS,
 * and a signature per key over @authority (req) and Content-Digest, tagged
 * http-message-signatures-directory, proving possession of the key.
 */
export async function operatorDirectoryResponse(input: {
  keys: OperatorKey[];
  /** The public authority the directory is served under. */
  authority: string;
  now?: number;
}) {
  const body = JSON.stringify({ keys: input.keys.map((k) => k.publicKey) });
  const digest = `sha-256=:${b64(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
  )}:`;
  const created = Math.floor((input.now ?? Date.now()) / 1000);
  const inputs: string[] = [],
    signatures: string[] = [];
  for (const [i, key] of input.keys.entries()) {
    const components: SignedComponent[] = [
      { id: '"@authority";req', value: input.authority.toLowerCase() },
      { id: '"content-digest"', value: digest },
    ];
    const params = signatureParams(
      components.map((c) => c.id),
      [
        ["created", created],
        ["expires", created + 86400],
        ["keyid", key.keyid],
        ["alg", "ed25519"],
        ["tag", "http-message-signatures-directory"],
      ],
    );
    const label = `sig${i + 1}`;
    inputs.push(`${label}=${params}`);
    signatures.push(
      `${label}=:${await signEd25519(key.privateKey, signatureBase(components, params))}:`,
    );
  }
  return {
    body,
    headers: {
      "Content-Type": "application/http-message-signatures-directory+json",
      "Cache-Control": "public, max-age=86400",
      "Content-Digest": digest,
      "Signature-Input": inputs.join(", "),
      Signature: signatures.join(", "),
    },
  };
}
