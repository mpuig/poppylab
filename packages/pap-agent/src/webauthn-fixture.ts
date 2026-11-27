/**
 * TEST ONLY: a software authenticator, as a phone or a password manager
 * would answer a WebAuthn ceremony. It keeps a P-256 key for each passkey
 * it creates, answers `create` with "none" attestation and `get` with a
 * signed assertion naming the account (its user handle), so the server
 * verifies real signatures over real authenticator data.
 */
import { createHash, randomBytes, webcrypto } from "node:crypto";

type CborValue =
  | number
  | string
  | Uint8Array
  | Map<CborValue, CborValue>
  | { [key: string]: CborValue };
const head = (major: number, length: number) => {
  if (length < 24) return [(major << 5) | length];
  if (length < 256) return [(major << 5) | 24, length];
  if (length < 65536) return [(major << 5) | 25, length >> 8, length & 255];
  return [
    (major << 5) | 26,
    (length >>> 24) & 255,
    (length >> 16) & 255,
    (length >> 8) & 255,
    length & 255,
  ];
};
/** The little CBOR a credential needs: integers, strings, bytes and maps. */
export function cbor(value: CborValue): Uint8Array {
  const parts: number[][] = [];
  const put = (v: CborValue) => {
    if (typeof v === "number")
      parts.push(v >= 0 ? head(0, v) : head(1, -1 - v));
    else if (typeof v === "string") {
      const bytes = [...Buffer.from(v, "utf8")];
      parts.push(head(3, bytes.length), bytes);
    } else if (v instanceof Uint8Array) parts.push(head(2, v.length), [...v]);
    else {
      const entries = v instanceof Map ? [...v] : Object.entries(v);
      parts.push(head(5, entries.length));
      for (const [k, item] of entries) {
        put(k);
        put(item);
      }
    }
  };
  put(value);
  return new Uint8Array(parts.flat());
}

const b64 = (bytes: Uint8Array | Buffer) =>
  Buffer.from(bytes).toString("base64url");
const u32 = (n: number) => [
  (n >>> 24) & 255,
  (n >> 16) & 255,
  (n >> 8) & 255,
  n & 255,
];
/** WebCrypto signs P-256 as r‖s; WebAuthn sends it as DER. */
function der(raw: Uint8Array) {
  const int = (bytes: Uint8Array) => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    const trimmed = [...bytes.slice(i)];
    return trimmed[0]! & 0x80 ? [0, ...trimmed] : trimmed;
  };
  const r = int(raw.slice(0, 32)),
    s = int(raw.slice(32));
  return new Uint8Array([
    0x30,
    r.length + s.length + 4,
    0x02,
    r.length,
    ...r,
    0x02,
    s.length,
    ...s,
  ]);
}

type Held = {
  id: Uint8Array;
  keys: webcrypto.CryptoKeyPair;
  userHandle: string;
  rpId: string;
  counter: number;
};
export type Answer = Record<string, unknown> & {
  id: string;
  response: Record<string, unknown>;
};

export function softwareAuthenticator(origin: string) {
  const held: Held[] = [];
  const flags = (uv: boolean, attested = false) =>
    0x01 | (uv ? 0x04 : 0) | (attested ? 0x40 : 0);
  const rpHash = (rpId: string) => [
    ...createHash("sha256").update(rpId).digest(),
  ];
  const clientData = (type: string, challenge: string, from = origin) =>
    Buffer.from(
      JSON.stringify({ type, challenge, origin: from, crossOrigin: false }),
    );
  return {
    held,
    /** `navigator.credentials.create` with these options. */
    async create(
      options: {
        challenge: string;
        rp: { id?: string };
        user: { id: string };
      },
      { uv = true, from = origin }: { uv?: boolean; from?: string } = {},
    ): Promise<Answer> {
      const rpId = options.rp.id ?? new URL(origin).hostname;
      const keys = (await webcrypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"],
      )) as webcrypto.CryptoKeyPair;
      const raw = new Uint8Array(
        await webcrypto.subtle.exportKey("raw", keys.publicKey),
      );
      const cose = cbor(
        new Map<CborValue, CborValue>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, raw.slice(1, 33)],
          [-3, raw.slice(33)],
        ]),
      );
      const id = new Uint8Array(randomBytes(16));
      const authData = new Uint8Array([
        ...rpHash(rpId),
        flags(uv, true),
        ...u32(0),
        ...new Uint8Array(16),
        id.length >> 8,
        id.length & 255,
        ...id,
        ...cose,
      ]);
      held.push({ id, keys, userHandle: options.user.id, rpId, counter: 0 });
      return {
        id: b64(id),
        rawId: b64(id),
        type: "public-key",
        response: {
          clientDataJSON: b64(
            clientData("webauthn.create", options.challenge, from),
          ),
          attestationObject: b64(cbor({ fmt: "none", attStmt: {}, authData })),
          transports: ["internal", "hybrid"],
        },
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      };
    },
    /**
     * `navigator.credentials.get`: answered with `pick` (the last passkey
     * created, by default), counting up when `counts`.
     */
    async get(
      options: { challenge: string; rpId?: string },
      {
        uv = true,
        from = origin,
        pick = held.at(-1),
        counts = false,
      }: { uv?: boolean; from?: string; pick?: Held; counts?: boolean } = {},
    ): Promise<Answer> {
      if (!pick) throw new Error("No passkey to answer with");
      if (counts) pick.counter++;
      const authData = new Uint8Array([
        ...rpHash(options.rpId ?? pick.rpId),
        flags(uv),
        ...u32(pick.counter),
      ]);
      const data = clientData("webauthn.get", options.challenge, from);
      const signed = new Uint8Array([
        ...authData,
        ...createHash("sha256").update(data).digest(),
      ]);
      const signature = new Uint8Array(
        await webcrypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          pick.keys.privateKey,
          signed,
        ),
      );
      return {
        id: b64(pick.id),
        rawId: b64(pick.id),
        type: "public-key",
        response: {
          clientDataJSON: b64(data),
          authenticatorData: b64(authData),
          signature: b64(der(signature)),
          userHandle: pick.userHandle,
        },
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      };
    },
  };
}
