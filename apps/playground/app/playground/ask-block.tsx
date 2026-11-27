"use client";
import { Check } from "lucide-react";
import { GRANT_WORDS } from "./account-row";
import { endedWords, type Ask } from "./asks";
import { CompanyMark } from "./company-mark";
import { mayChange, type CompanyState } from "./company-state";
import { extensionOf, type Playground } from "./use-playground";

/** The element ID of an ask, for the inbox to bring it into view. */
export const askId = (key: string) =>
  `ask-${key.replace(/https?:\/\//, "").replace(/[^A-Za-z0-9_-]+/g, "-")}`;

/**
 * One ask about a Company's account, where it arose in the transcript:
 * its sentence and its button while it waits, the tab to finish while a
 * sign-in for it is open, and one line once it is done. `named` heads it
 * with the Company, where the conversation has several.
 */
export function AskBlock({
  ask,
  c,
  p,
  named,
  onPressed,
}: {
  ask: Ask;
  c: CompanyState;
  p: Playground;
  named: boolean;
  /** A button was pressed: `keyboard` when from the keyboard. */
  onPressed?: (keyboard: boolean) => void;
}) {
  const { busy } = p;
  const extension = extensionOf(c);
  const id = askId(ask.key);
  const mark = named ? <CompanyMark origin={c.origin} /> : null;
  if (ask.phase === "done")
    return (
      <p className="ask-block done" id={id} tabIndex={-1}>
        <Check size={14} strokeWidth={2.5} aria-hidden="true" />
        {mark}
        {ask.ended ?? endedWords(ask.kind, c)}
      </p>
    );
  const signIn = (access: "read" | "write") => () =>
    void p.accountAction("signin", c.origin, undefined, access);
  const press = (then: () => void) => (event: { detail: number }) => {
    onPressed?.(event.detail === 0);
    then();
  };
  if (ask.phase === "underway")
    return (
      <div className="ask-block waiting" id={id} tabIndex={-1}>
        <p>
          {mark}
          <span className="waits">Waiting for you</span> · Finish signing in on{" "}
          {c.name}&apos;s own page, in its tab. Iris never sees your password.
        </p>
        <div className="ask-actions">
          <button
            type="button"
            className="ghost-button"
            disabled={busy}
            onClick={signIn(ask.kind === "write" ? "write" : "read")}
          >
            Open {c.name}&apos;s page again
          </button>
        </div>
      </div>
    );
  const waits = ask.kind !== "signin" && ask.kind !== "write";
  return (
    <div
      className={`ask-block ${waits ? "waiting" : ""}`}
      id={id}
      tabIndex={-1}
    >
      <p>
        {mark}
        {waits && <span className="waits">Waiting for you</span>}
        {waits && " · "}
        {ask.kind === "signin" &&
          `Iris can read your ${c.name} account once you sign in, read only, on ${c.name}'s own page. Account access is optional; only connect accounts you trust.`}
        {ask.kind === "write" &&
          `To ask ${c.name} for a change, Iris needs change permission there. It opens ${c.name}'s consent page again, and you approve the change itself separately.`}
        {ask.kind === "lost" &&
          (c.grantRevoked && extension
            ? `${GRANT_WORDS[extension.key][c.grantRevoked === "revoked" ? "revoked" : "ended"](c.name)}`
            : (c.recovery ??
              `${c.name} no longer takes your sign-in. Sign in again to go on with your account there.`))}
        {ask.kind === "extension" &&
          extension &&
          `Use ${extension.label} is on, and your sign-in at ${c.name} doesn't share it yet.`}
        {ask.kind === "invitation" &&
          `${c.name} asks to talk with you directly${c.direct.invitation ? `: ${c.direct.invitation}` : "."} Iris won't read or answer there; you can leave at any time.`}
      </p>
      <div className="ask-actions">
        {ask.kind === "invitation" ? (
          <>
            <button
              type="button"
              className="connect-button"
              disabled={busy}
              onClick={press(() => p.directAction("accept", c.origin))}
            >
              Talk to {c.name}
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={busy}
              onClick={press(() => p.directAction("decline", c.origin))}
            >
              Not now
            </button>
          </>
        ) : (
          <button
            type="button"
            className={ask.kind === "write" ? "ghost-button" : "connect-button"}
            disabled={busy}
            onClick={signIn(
              ask.kind === "write" || (ask.kind === "extension" && mayChange(c))
                ? "write"
                : "read",
            )}
          >
            {ask.kind === "write"
              ? "Request change permission"
              : ask.kind === "extension" && extension
                ? GRANT_WORDS[extension.key].again
                : ask.kind === "lost"
                  ? `Sign in to ${c.name} again`
                  : `Sign in to ${c.name} · read only`}
          </button>
        )}
      </div>
    </div>
  );
}
