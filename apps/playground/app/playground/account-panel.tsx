"use client";

import { useCallback, useEffect, useState } from "react";
import {
  addPasskey,
  bringConversations,
  broughtSentence,
  ceremonyFailure,
  createAccount,
  passkeysWork,
  readAccount,
  readSessions,
  removePasskey,
  revokeAll,
  revokeSession,
  signIn,
  signOut,
  type AccountView,
  type SessionView,
} from "./agent-account";

const day = (time: number) =>
  new Date(time).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const when = (time: number) =>
  new Date(time).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const count = (n: number) =>
  n === 1 ? "1 conversation" : `${n} conversations`;

/**
 * Removes a passkey and reads the account again: removing the passkey this
 * device signed in with signs this device out too, and removing another may
 * sign out other devices, so the sessions list is refreshed while signed in.
 */
export async function removePasskeyAndRefresh(
  id: string,
  onChange: (account: AccountView | null) => void,
  refreshSessions: () => void,
  io: {
    remove: typeof removePasskey;
    read: typeof readAccount;
  } = { remove: removePasskey, read: readAccount },
) {
  const updated = await io.remove(id);
  const next = await io.read().catch(() => updated);
  onChange(next);
  if (next) refreshSessions();
}

/**
 * The person's agent account, at the top of the Identity view: create one
 * with a passkey or sign in with one; once signed in, its passkeys, the
 * devices signed in to it, and bringing this browser's conversations in.
 * `onChange` gets the account as it now is, or null once signed out.
 */
export function AccountPanel({
  account,
  onChange,
}: {
  account: AccountView | null | undefined;
  onChange: (account: AccountView | null) => void;
}) {
  const [label, setLabel] = useState("");
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [sessions, setSessions] = useState<SessionView[] | null>(null);
  const [everywhere, setEverywhere] = useState(false);
  const [supported, setSupported] = useState(true);
  useEffect(() => setSupported(passkeysWork()), []);

  const loadSessions = useCallback(() => {
    void readSessions()
      .then(setSessions)
      .catch(() => setSessions(null));
  }, []);
  const signedIn = !!account;
  useEffect(() => {
    if (signedIn) loadSessions();
    else setSessions(null);
  }, [signedIn, loadSessions]);

  /** Runs one action, says what went wrong, and keeps the rest as it was. */
  async function act(name: string, work: () => Promise<void>) {
    setWorking(name);
    setError("");
    setStatus("");
    try {
      await work();
    } catch (failure) {
      setError(ceremonyFailure(failure, name));
    } finally {
      setWorking(null);
    }
  }

  if (account === undefined) return <p className="quiet">Loading…</p>;

  if (!account)
    return (
      <section className="account-panel" aria-labelledby="account-title">
        <h2 id="account-title">Your account</h2>
        <p>
          An account keeps your conversations and connected companies on every
          device you sign in on. There is no email or password, and nothing
          about you is asked for. Without one, your conversations stay in this
          browser.
        </p>
        <p className="quiet">
          A passkey is a sign-in key that your phone or computer keeps for this
          site and unlocks with your face, your fingerprint or your screen lock.
        </p>
        {supported ? (
          <>
            <label className="account-label">
              <span>Name for the account (optional)</span>
              <input
                value={label}
                maxLength={60}
                autoComplete="off"
                placeholder="For example, Home"
                onChange={(event) => setLabel(event.target.value)}
              />
            </label>
            <div className="account-actions">
              <button
                type="button"
                className="connect-button"
                disabled={!!working}
                onClick={() =>
                  void act("Creating the account", async () => {
                    onChange(await createAccount(label));
                    setLabel("");
                  })
                }
              >
                {working === "Creating the account"
                  ? "Creating…"
                  : "Create an account with a passkey"}
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={!!working}
                onClick={() =>
                  void act("Signing in", async () => onChange(await signIn()))
                }
              >
                {working === "Signing in"
                  ? "Signing in…"
                  : "Sign in with a passkey"}
              </button>
            </div>
          </>
        ) : (
          <p className="inspector-empty">
            This browser can’t use passkeys, so it can’t create an account or
            sign in to one. Your conversations stay in this browser.
          </p>
        )}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
      </section>
    );

  const unclaimed = account.unclaimed ?? 0;
  const one = account.passkeys.length <= 1;
  return (
    <section className="account-panel" aria-labelledby="account-title">
      <h2 id="account-title">Your account</h2>
      <dl className="account-facts">
        <div>
          <dt>Account</dt>
          <dd>
            {account.label ?? "Unnamed"}{" "}
            <span className="quiet">· created {day(account.created)}</span>
          </dd>
        </div>
        <div>
          <dt>This device</dt>
          <dd className="account-device">
            <span>Signed in</span>
            <button
              type="button"
              className="ghost-button"
              disabled={!!working}
              onClick={() =>
                void act("Signing out", async () => {
                  await signOut();
                  onChange(null);
                })
              }
            >
              Sign out on this device
            </button>
          </dd>
        </div>
      </dl>

      {unclaimed > 0 && (
        <div className="account-bring">
          <p>
            This browser has {count(unclaimed)} from before you signed in.{" "}
            {unclaimed === 1
              ? "It opens only here until you bring it into your account."
              : "They open only here until you bring them into your account."}
          </p>
          <button
            type="button"
            className="connect-button"
            disabled={!!working}
            onClick={() =>
              void act("Bringing them in", async () => {
                const done = await bringConversations();
                onChange(done.account);
                setStatus(broughtSentence(done.moved, done.skipped));
              })
            }
          >
            {working === "Bringing them in"
              ? "Bringing them in…"
              : "Bring this browser’s conversations into your account"}
          </button>
        </div>
      )}

      <h3>Passkeys</h3>
      <ul className="account-list">
        {account.passkeys.map((passkey) => (
          <li key={passkey.id}>
            <span>
              <strong>Added on {passkey.name}</strong>
              <span>
                {day(passkey.created)}
                {passkey.lastUsed
                  ? ` · last used ${when(passkey.lastUsed)}`
                  : ""}
                {passkey.synced ? " · synced to your other devices" : ""}
              </span>
            </span>
            {!one && (
              <button
                type="button"
                className="ghost-button"
                disabled={!!working}
                onClick={() =>
                  void act("Removing the passkey", () =>
                    removePasskeyAndRefresh(passkey.id, onChange, loadSessions),
                  )
                }
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="account-actions">
        <button
          type="button"
          className="ghost-button"
          disabled={!!working}
          onClick={() =>
            void act("Adding the passkey", async () => {
              onChange(await addPasskey());
              setStatus("Passkey added. You can sign in with either one.");
            })
          }
        >
          {working === "Adding the passkey" ? "Adding…" : "Add a passkey"}
        </button>
        {one && (
          <span className="quiet">
            An account keeps at least one passkey, so this one can’t be removed.
          </span>
        )}
      </div>

      <h3>Devices</h3>
      {sessions === null ? (
        <p className="quiet">Loading…</p>
      ) : (
        <ul className="account-list">
          {sessions.map((session) => (
            <li key={session.id}>
              <span>
                <strong>
                  {session.device}
                  {session.current && (
                    <span className="account-current"> · this device</span>
                  )}
                </strong>
                <span>
                  {session.kind === "app" ? "App" : "Browser"} · signed in{" "}
                  {when(session.created)} · last used {when(session.lastUsed)}
                </span>
              </span>
              {!session.current && (
                <button
                  type="button"
                  className="ghost-button"
                  disabled={!!working}
                  onClick={() =>
                    void act("Signing the device out", async () => {
                      await revokeSession(session.id);
                      loadSessions();
                      setStatus(`${session.device} is signed out.`);
                    })
                  }
                >
                  Sign out
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="account-actions">
        {everywhere ? (
          <>
            <span>Sign out every device, this one too?</span>
            <button
              type="button"
              className="ghost-button"
              disabled={!!working}
              onClick={() =>
                void act("Signing out everywhere", async () => {
                  await revokeAll();
                  setEverywhere(false);
                  onChange(null);
                })
              }
            >
              Yes, sign out everywhere
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setEverywhere(false)}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="text-button"
            onClick={() => setEverywhere(true)}
          >
            Sign out everywhere
          </button>
        )}
      </div>
      <p role="status" className="account-status">
        {status}
      </p>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
