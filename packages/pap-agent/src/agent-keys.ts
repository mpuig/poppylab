import { createHmac } from "node:crypto";
import {
  createIdentity,
  deriveOperatorKey,
  onWorkers,
  stateDirectory,
  type OperatorKey,
} from "@poppy-lab/pap-client";
import { isLocalCompany, LOCAL_AGENT_ORIGIN } from "@poppy-lab/pap-core";
import type { JWK } from "jose";
import type { Connection } from "./run-types";

export const agentOrigin = (
  process.env.AGENT_PUBLIC_ORIGIN ?? LOCAL_AGENT_ORIGIN
).replace(/\/$/, "");
if (
  new URL(agentOrigin).origin !== agentOrigin ||
  !["https:", "http:"].includes(new URL(agentOrigin).protocol)
)
  throw Error(
    "Invalid AGENT_PUBLIC_ORIGIN: use an origin without credentials, path, query or fragment",
  );
export const clientId = `${agentOrigin}/agent/client.json`;
export function agentFor(connection: Connection) {
  return isLocalCompany(new URL(connection.url).origin)
    ? LOCAL_AGENT_ORIGIN
    : agentOrigin;
}
export function clientFor(connection: Connection) {
  return `${agentFor(connection)}/agent/client.json`;
}
let identityPromise: Promise<{ publicKey: JWK; privateKey: JWK }> | undefined;
/**
 * §5.3: the Web Bot Auth operator key, derived from the identity secret so
 * a deployment needs no other secret. It is not a jwks_uri key and never
 * signs Session JWTs or assertions.
 */
let operator: Promise<OperatorKey> | undefined;
export function operatorKey() {
  return (operator ??= identity().then((keys) =>
    deriveOperatorKey(Buffer.from(String(keys.privateKey.d), "base64url")),
  ));
}

/**
 * The jwks_uri key: signs only delegations and client assertions (§4.1,
 * §5.2). A deployment sets `POPPY_IDENTITY` (a Worker secret); otherwise a
 * local key file is created once.
 */
export function identity() {
  return (identityPromise ??= (async () => {
    if (process.env.POPPY_IDENTITY) {
      const parsed = JSON.parse(process.env.POPPY_IDENTITY) as {
        publicKey?: JWK;
        privateKey?: JWK;
      };
      if (
        parsed.publicKey?.kty !== "EC" ||
        "d" in parsed.publicKey ||
        !parsed.privateKey?.d
      )
        throw Error("Invalid POPPY_IDENTITY");
      return parsed as { publicKey: JWK; privateKey: JWK };
    }
    if (onWorkers()) throw Error("Set the POPPY_IDENTITY secret");
    const { mkdir, readFile, writeFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const directory = stateDirectory();
    const filename = path.join(directory, "identity.json");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      return JSON.parse(await readFile(filename, "utf8")) as {
        publicKey: JWK;
        privateKey: JWK;
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const generated = await createIdentity();
    try {
      await writeFile(filename, JSON.stringify(generated), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return JSON.parse(await readFile(filename, "utf8")) as typeof generated;
    }
    return generated;
  })());
}

/**
 * The visitor's User ID for one Company identifier: stable for that visitor,
 * unlinkable across Companies and visitors (§3.2), and kept nowhere.
 */
export async function userFor(
  visitor: string,
  identifier: string,
  /** Changes when the visitor resets the demo: a new person to every Company. */
  epoch?: string,
) {
  const secret = createHmac("sha256", "poppy-user-ids")
    .update(String((await identity()).privateKey.d))
    .digest();
  return `usr_${createHmac("sha256", secret)
    .update(
      `${visitor}\n${new URL(identifier).href}${epoch ? `\n${epoch}` : ""}`,
    )
    .digest("base64url")
    .slice(0, 32)}`;
}
