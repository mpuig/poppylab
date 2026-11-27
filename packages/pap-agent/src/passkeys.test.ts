import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountBackend, loadAccount } from "./account-store";
import {
  addOptions,
  addPasskey,
  createOptions,
  createWithPasskey,
  relyingParty,
  removePasskey,
  signInOptions,
  verifySignIn,
} from "./passkeys";
import { configureBackend, memoryBackend } from "./runs";
import { softwareAuthenticator } from "./webauthn-fixture";

const origin = "http://localhost:3991";
const rp = relyingParty(origin);
beforeEach(() => configureBackend(memoryBackend()));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function newAccount(label?: string) {
  const authenticator = softwareAuthenticator(origin);
  const { ceremony, options } = await createOptions(rp, { label });
  const credential = await authenticator.create(options);
  const created = await createWithPasskey(rp, {
    ceremony,
    credential,
    device: "Chrome on macOS",
  });
  if ("status" in created) throw new Error(created.error);
  return { authenticator, ...created };
}

describe("creating an account", () => {
  it("keeps an opaque ID, the label and the passkey's public key, and nothing else", async () => {
    const { account, passkey } = await newAccount("Home");
    expect(account).toEqual({
      id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
      label: "Home",
      created: expect.any(Number),
      user: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      passkeys: [passkey],
      channels: [],
    });
    expect(passkey).toMatchObject({
      name: "Chrome on macOS",
      counter: 0,
      transports: ["internal", "hybrid"],
    });
    expect((await loadAccount(account.id))?.account).toEqual(account);
  });

  it("asks for a discoverable passkey with user verification and no attestation, for this host", async () => {
    const { options } = await createOptions(relyingParty(origin), {});
    expect(options).toMatchObject({
      rp: { id: "localhost" },
      attestation: "none",
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
      user: { name: "Iris account" },
    });
  });

  it("is for the deployment's own host in public mode, whatever the request says", () => {
    vi.stubEnv("POPPY_PUBLIC", "true");
    vi.stubEnv("AGENT_PUBLIC_ORIGIN", "https://poppylab.dev");
    expect(relyingParty("https://evil.example")).toEqual({
      id: "poppylab.dev",
      origin: "https://poppylab.dev",
    });
  });

  it("takes each challenge once", async () => {
    const authenticator = softwareAuthenticator(origin);
    const { ceremony, options } = await createOptions(rp, {});
    const credential = await authenticator.create(options);
    const input = { ceremony, credential, device: "A device" };
    expect(await createWithPasskey(rp, input)).toHaveProperty("account");
    expect(await createWithPasskey(rp, input)).toMatchObject({
      code: "ceremony_expired",
    });
  });

  it("refuses a challenge more than five minutes old, and leaves no account", async () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
    const authenticator = softwareAuthenticator(origin);
    const { ceremony, options } = await createOptions(rp, {});
    const credential = await authenticator.create(options);
    vi.setSystemTime(Date.now() + 5 * 60000 + 1);
    expect(
      await createWithPasskey(rp, { ceremony, credential, device: "x" }),
    ).toMatchObject({ code: "ceremony_expired" });
    const id = Buffer.from(options.user.id, "base64url").toString("base64url");
    expect(await loadAccount(id)).toBeUndefined();
  });

  it("refuses an answer without user verification, from another origin, or to another challenge", async () => {
    const authenticator = softwareAuthenticator(origin);
    for (const [answer, why] of [
      [{ uv: false }, "no user verification"],
      [{ from: "https://evil.example" }, "another origin"],
    ] as const) {
      const { ceremony, options } = await createOptions(rp, {});
      const credential = await authenticator.create(options, answer);
      expect(
        await createWithPasskey(rp, { ceremony, credential, device: "x" }),
        why,
      ).toMatchObject({ code: "passkey_not_verified" });
    }
    const first = await createOptions(rp, {});
    const second = await createOptions(rp, {});
    const credential = await authenticator.create(second.options);
    expect(
      await createWithPasskey(rp, {
        ceremony: first.ceremony,
        credential,
        device: "x",
      }),
    ).toMatchObject({ code: "passkey_not_verified" });
  });

  it("refuses a ceremony of another kind", async () => {
    const authenticator = softwareAuthenticator(origin);
    const { ceremony, options } = await signInOptions(rp);
    const credential = await authenticator.create({
      challenge: options.challenge,
      rp: { id: "localhost" },
      user: { id: "AAAAAAAAAAAAAAAAAAAAAA" },
    });
    expect(
      await createWithPasskey(rp, { ceremony, credential, device: "x" }),
    ).toMatchObject({ code: "ceremony_expired" });
  });
});

describe("signing in", () => {
  it("needs no username: the passkey names its account, and its use is written", async () => {
    const { authenticator, account, passkey } = await newAccount();
    const { ceremony, options } = await signInOptions(rp);
    expect(options).not.toHaveProperty("allowCredentials.0");
    expect(options.userVerification).toBe("required");
    const proved = await verifySignIn(rp, {
      ceremony,
      credential: await authenticator.get(options, { counts: true }),
    });
    expect(proved).toMatchObject({
      account: { id: account.id },
      passkey: { id: passkey.id },
    });
    const stored = (await loadAccount(account.id))!.account.passkeys[0]!;
    expect(stored.counter).toBe(1);
    expect(stored.lastUsed).toEqual(expect.any(Number));
  });

  it("refuses a passkey the account doesn't have, a reused challenge and a counter that went back", async () => {
    const { authenticator } = await newAccount();
    const stranger = softwareAuthenticator(origin);
    const other = await createOptions(rp, {});
    // A passkey made but never saved: no account has it.
    await stranger.create(other.options);
    const one = await signInOptions(rp);
    expect(
      await verifySignIn(rp, {
        ceremony: one.ceremony,
        credential: await stranger.get(one.options),
      }),
    ).toMatchObject({ status: 401, code: "passkey_unknown" });

    const two = await signInOptions(rp);
    const answer = await authenticator.get(two.options, { counts: true });
    expect(
      await verifySignIn(rp, { ceremony: two.ceremony, credential: answer }),
    ).toHaveProperty("account");
    expect(
      await verifySignIn(rp, { ceremony: two.ceremony, credential: answer }),
    ).toMatchObject({ code: "ceremony_expired" });

    // A cloned authenticator answers with a counter it used already.
    authenticator.held[0]!.counter = 0;
    const three = await signInOptions(rp);
    expect(
      await verifySignIn(rp, {
        ceremony: three.ceremony,
        credential: await authenticator.get(three.options, { counts: true }),
      }),
    ).toMatchObject({ code: "passkey_not_verified" });
  });

  it("refuses an answer without user verification", async () => {
    const { authenticator } = await newAccount();
    const { ceremony, options } = await signInOptions(rp);
    expect(
      await verifySignIn(rp, {
        ceremony,
        credential: await authenticator.get(options, { uv: false }),
      }),
    ).toMatchObject({ code: "passkey_not_verified" });
  });
});

describe("an account's passkeys", () => {
  it("adds one, signs in with either, and keeps at least one", async () => {
    const { authenticator, account } = await newAccount();
    const phone = softwareAuthenticator(origin);
    const started = await addOptions(rp, account);
    if ("status" in started) throw new Error(started.error);
    expect(started.options.excludeCredentials).toEqual([
      expect.objectContaining({ id: account.passkeys[0]!.credentialId }),
    ]);
    const added = await addPasskey(rp, account, {
      ceremony: started.ceremony,
      credential: await phone.create(started.options),
      device: "iPhone",
    });
    if ("status" in added) throw new Error(added.error);
    expect(added.account.passkeys.map((p) => p.name)).toEqual([
      "Chrome on macOS",
      "iPhone",
    ]);
    for (const device of [authenticator, phone]) {
      const { ceremony, options } = await signInOptions(rp);
      expect(
        await verifySignIn(rp, {
          ceremony,
          credential: await device.get(options),
        }),
      ).toHaveProperty("account.id", account.id);
    }

    const first = added.account.passkeys[0]!;
    const left = await removePasskey(account.id, first.id);
    expect("passkeys" in left && left.passkeys.map((p) => p.id)).toEqual([
      added.passkey.id,
    ]);
    expect(await removePasskey(account.id, added.passkey.id)).toMatchObject({
      status: 409,
      code: "last_passkey",
    });
    // The removed one signs in no one any more.
    const { ceremony, options } = await signInOptions(rp);
    expect(
      await verifySignIn(rp, {
        ceremony,
        credential: await authenticator.get(options),
      }),
    ).toMatchObject({ code: "passkey_unknown" });
  });

  it("keeps one when two devices remove the last two at once", async () => {
    const { account } = await newAccount();
    const phone = softwareAuthenticator(origin);
    const started = await addOptions(rp, account);
    if ("status" in started) throw new Error(started.error);
    const added = await addPasskey(rp, account, {
      ceremony: started.ceremony,
      credential: await phone.create(started.options),
      device: "iPhone",
    });
    if ("status" in added) throw new Error(added.error);
    const [a, b] = added.account.passkeys;
    const results = await Promise.all([
      removePasskey(account.id, a!.id),
      removePasskey(account.id, b!.id),
    ]);
    expect(results.filter((r) => "code" in r)).toHaveLength(1);
    expect((await loadAccount(account.id))!.account.passkeys).toHaveLength(1);
  });

  it("is refused for a ceremony started for another account", async () => {
    const one = await newAccount();
    const two = await newAccount();
    const started = await addOptions(rp, one.account);
    if ("status" in started) throw new Error(started.error);
    expect(
      await addPasskey(rp, two.account, {
        ceremony: started.ceremony,
        credential: await softwareAuthenticator(origin).create(started.options),
        device: "x",
      }),
    ).toMatchObject({ code: "ceremony_expired" });
  });

  it("are kept in the account store, apart from conversations", async () => {
    const { account } = await newAccount();
    expect(
      await accountBackend().get(`account:${account.id}`, "account"),
    ).toBeDefined();
  });
});
