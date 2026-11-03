import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { NonceChallenge, type DpopNonces } from "@poppy-lab/pap-company";
/** Kept for tests and callers: the gateway's nonce challenge. */
export const NonceRequired = NonceChallenge;
export function nonceAuthority(ttl = 60000) {
  const secret = randomBytes(32);
  const mac = (scope: string, binding: string, value: string) =>
    createHmac("sha256", secret)
      .update(`${scope}\n${binding}\n${value}`)
      .digest("base64url");
  return (scope: string) => (nonce: unknown, binding: string) => {
    if (typeof nonce === "string" && nonce.length <= 256) {
      const [time, random, signature, ...extra] = nonce.split(".");
      const value = `${time}.${random}`;
      const expected = mac(scope, binding, value);
      if (
        !extra.length &&
        time &&
        random &&
        signature &&
        /^\d+$/.test(time) &&
        Date.now() - Number(time) >= 0 &&
        Date.now() - Number(time) < ttl &&
        /^[A-Za-z0-9_-]{43}$/.test(signature) &&
        signature.length === expected.length &&
        timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
      )
        return;
    }
    const value = `${Date.now()}.${randomBytes(16).toString("base64url")}`;
    throw new NonceChallenge(`${value}.${mac(scope, binding, value)}`);
  };
}
/** RFC 9449 server nonces, bound to the DPoP key and scope, valid 60 s. */
export function dpopNonces(ttl = 60000): DpopNonces {
  const authority = nonceAuthority(ttl);
  const token = authority("token"),
    api = authority("api");
  return {
    check: (scope, nonce, binding) =>
      (scope === "token" ? token : api)(nonce, binding),
  };
}
