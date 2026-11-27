/**
 * Encryption at rest for per-visitor state on Workers. A Run holds refresh
 * and access tokens and the delegated and DPoP private keys, so Durable
 * Object storage only ever sees AES-256-GCM ciphertext, bound to its row
 * (visitor and key) as additional data. The key is the `POPPY_STATE_KEY`
 * Worker secret: 32 random bytes, base64url. Node's vault encrypts on disk
 * already, so this wraps only the Durable Object backend.
 */
import type { Backend, Versioned } from "./runs";

const te = new TextEncoder(),
  td = new TextDecoder();
const b64 = {
  encode: (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url"),
  decode: (text: string) => new Uint8Array(Buffer.from(text, "base64url")),
};
type Sealed = { v: 1; iv: string; ct: string };
const isSealed = (x: unknown): x is Sealed =>
  !!x &&
  typeof x === "object" &&
  (x as Sealed).v === 1 &&
  typeof (x as Sealed).iv === "string" &&
  typeof (x as Sealed).ct === "string";

export async function importStateKey(secret: string | undefined) {
  const raw = secret ? b64.decode(secret) : new Uint8Array();
  if (raw.byteLength !== 32)
    throw new Error("POPPY_STATE_KEY must be 32 bytes, base64url");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function seal(
  key: CryptoKey,
  aad: string,
  value: unknown,
): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: te.encode(aad) },
    key,
    te.encode(JSON.stringify(value)),
  );
  return { v: 1, iv: b64.encode(iv), ct: b64.encode(new Uint8Array(ct)) };
}

export async function unseal(key: CryptoKey, aad: string, sealed: unknown) {
  if (!isSealed(sealed)) throw new Error("Unsealed record");
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: b64.decode(sealed.iv),
      additionalData: te.encode(aad),
    },
    key,
    b64.decode(sealed.ct),
  );
  return JSON.parse(td.decode(plain)) as unknown;
}

/** Wraps a backend so every stored value is sealed; counters stay plain. */
export function sealedBackend(
  inner: Backend,
  keyPromise: Promise<CryptoKey>,
): Backend {
  const aad = (visitor: string, k: string) => `${visitor}\n${k}`;
  const open = async (
    visitor: string,
    k: string,
    entry: Versioned | undefined,
  ): Promise<Versioned | undefined> => {
    if (!entry) return undefined;
    try {
      const key = await keyPromise;
      return {
        ...entry,
        value: await unseal(key, aad(visitor, k), entry.value),
      };
    } catch {
      // A record this key can't open (rotated key, tampering) is treated as
      // absent, never as data.
      return undefined;
    }
  };
  return {
    get: async (visitor, k) => open(visitor, k, await inner.get(visitor, k)),
    put: async (visitor, k, value, expected) =>
      inner.put(
        visitor,
        k,
        await seal(await keyPromise, aad(visitor, k), value),
        expected,
      ),
    remove: (visitor, k) => inner.remove(visitor, k),
    list: async (visitor, prefix) => {
      const out: Array<[string, Versioned]> = [];
      for (const [k, entry] of await inner.list(visitor, prefix)) {
        const opened = await open(visitor, k, entry);
        if (opened) out.push([k, opened]);
      }
      return out;
    },
    count: (visitor, k, windowMs) => inner.count(visitor, k, windowMs),
  };
}
