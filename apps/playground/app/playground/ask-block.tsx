"use client";
import { Check } from "lucide-react";
import { say } from "@poppy-lab/pap-agent/lines";
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
  // A page made before it knew the conversation's language says English.
  const language = p.language ?? "en";
  const extension = extensionOf(c);
  const id = askId(ask.key);
  const mark = named ? <CompanyMark origin={c.origin} /> : null;
  if (ask.phase === "done")
    return (
      <p className="ask-block done" id={id} tabIndex={-1}>
        <Check size={14} strokeWidth={2.5} aria-hidden="true" />
        {mark}
        {ask.ended ?? endedWords(ask.kind, c, language)}
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
          <span className="waits">{say(language, "waitingForYou")}</span> ·{" "}
          {say(language, "askUnderway", { name: c.name })}
        </p>
        <div className="ask-actions">
          <button
            type="button"
            className="ghost-button"
            disabled={busy}
            onClick={signIn(
              c.signingIn?.access ??
                (ask.kind === "write" ||
                (ask.kind === "extension" && mayChange(c))
                  ? "write"
                  : "read"),
            )}
          >
            {say(language, "openPageAgain", { name: c.name })}
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
        {waits && (
          <span className="waits">{say(language, "waitingForYou")}</span>
        )}
        {waits && " · "}
        {ask.kind === "signin" && say(language, "askSignIn", { name: c.name })}
        {ask.kind === "write" && say(language, "askWrite", { name: c.name })}
        {ask.kind === "lost" &&
          (c.grantRevoked && extension
            ? `${GRANT_WORDS[extension.key][c.grantRevoked === "revoked" ? "revoked" : "ended"](c.name)}`
            : (c.recovery ?? say(language, "askLost", { name: c.name })))}
        {ask.kind === "extension" &&
          extension &&
          `Use ${extension.label} is on, and your sign-in at ${c.name} doesn't share it yet.`}
        {ask.kind === "invitation" &&
          say(language, "askInvitation", {
            name: c.name,
            reason: c.direct.invitation || undefined,
          })}
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
              {say(language, "talkButton", { name: c.name })}
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={busy}
              onClick={press(() => p.directAction("decline", c.origin))}
            >
              {say(language, "notNowButton")}
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
              ? say(language, "requestChangeButton")
              : ask.kind === "extension" && extension
                ? GRANT_WORDS[extension.key].again
                : ask.kind === "lost"
                  ? say(language, "signInAgainButton", { name: c.name })
                  : say(language, "signInButton", { name: c.name })}
          </button>
        )}
      </div>
    </div>
  );
}
