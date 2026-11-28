/**
 * The page's own asks about a Company's account, each a block of the
 * transcript at the point it arose (`transcript-items.ts`): a sign-in the
 * guide suggests, the change permission it suggests, a sign-in to finish
 * in the Company's tab, a sign-in to do again once the Company stopped
 * taking it, and a Company's invitation to talk directly. While one waits
 * it has its button; once it is done it folds to how it ended and stays;
 * one that is no longer needed, never done, goes. Signing out, the access
 * level and the standing instruction are not asks: they stay in the
 * Company's panel in the Companies bar.
 *
 * Plain data: `nextAsks` reads the page's state and the asks it showed
 * before, and says what to show now.
 */
import type { Language } from "@poppy-lab/pap-agent/language";
import { say } from "@poppy-lab/pap-agent/lines";
import { mayChange, type CompanyState } from "./company-state";

export type AskKind =
  "signin" | "write" | "signing" | "lost" | "extension" | "invitation";

/** One ask, at one Company, and where it stands. */
export type Ask = {
  key: string;
  kind: AskKind;
  origin: string;
  /**
   * `open`: it waits for the person. `underway`: a sign-in for it is open
   * in the Company's tab. `done`: it was done, and says how.
   */
  phase: "open" | "underway" | "done";
  /** Once done, how it ended, in the words of that moment. */
  ended?: string;
};

/** How an ask ended, in one line, in the conversation's language. */
export function endedWords(
  kind: AskKind,
  c: CompanyState,
  language: Language = "en",
) {
  return kind === "write"
    ? say(language, "askDoneWrite", { name: c.name })
    : say(language, "askDoneSignIn", { name: c.name, write: mayChange(c) });
}

/** What the page knows that decides the asks, Company by Company. */
export type AskState = {
  companies: readonly CompanyState[];
  /** The Company the guide speaks about, and its step (0 to 4). */
  guide: { origin: string | undefined; step: number };
  /** Change permission can still be asked for at this Company. */
  moreAccess: (c: CompanyState) => boolean;
  /** Use FDX or Use ESPI is on, and this sign-in lacks its scopes. */
  extensionSignIn: (c: CompanyState) => boolean;
  /** The Company offers sign-in to agents, and this page may use it. */
  offersSignIn: (c: CompanyState) => boolean;
  /** Iris's open question asks for a sign-in or an answer there already. */
  askedAt: (origin: string) => boolean;
  readOnly: boolean;
  /** The conversation's language, for how an ask ended. */
  language?: Language;
};

const keyOf = (kind: AskKind, origin: string) => `ask ${kind} ${origin}`;

/** Whether an ask is wanted now, by the state alone. */
function wanted(kind: AskKind, c: CompanyState, s: AskState) {
  if (s.readOnly) return false;
  const guided = s.guide.origin === c.origin && !s.askedAt(c.origin);
  switch (kind) {
    case "signing":
      return !!c.signingIn;
    case "signin":
      return (
        guided &&
        s.guide.step === 1 &&
        !c.signedIn &&
        !c.signingIn &&
        !c.recovery &&
        !c.grantRevoked &&
        s.offersSignIn(c)
      );
    case "write":
      return (
        guided &&
        s.guide.step === 2 &&
        c.signedIn &&
        !c.signingIn &&
        !mayChange(c) &&
        s.moreAccess(c)
      );
    case "lost":
      return !c.signedIn && !c.signingIn && !!(c.recovery || c.grantRevoked);
    case "extension":
      return !c.signingIn && s.extensionSignIn(c);
    case "invitation":
      return (
        c.direct.invitation !== null && !c.direct.direct && !s.askedAt(c.origin)
      );
  }
}

/** Whether what the ask was for is done. */
function done(kind: AskKind, c: CompanyState, s: AskState) {
  if (c.signingIn) return false;
  if (kind === "write") return mayChange(c);
  if (kind === "invitation") return false;
  return c.signedIn && !s.extensionSignIn(c);
}

const KINDS: AskKind[] = ["lost", "extension", "signin", "write", "invitation"];

/**
 * The asks to show now. `shown` holds the asks shown before, by key, and
 * `arrivals` where each arose (`transcript-items.ts`); both are updated
 * here. A sign-in that starts while an ask is open is that ask's, under
 * way; one started elsewhere (the bar, Iris's question) is an ask of its
 * own. An ask that was done and is wanted again is a new one, where it
 * arises again: the one done stays where it was.
 */
export function nextAsks(
  s: AskState,
  shown: Map<string, Ask>,
  arrivals: Map<string, number>,
): Ask[] {
  const asks: Ask[] = [];
  const keep = (ask: Ask) => {
    shown.set(ask.key, ask);
    asks.push(ask);
  };
  const drop = (key: string) => {
    shown.delete(key);
    arrivals.delete(key);
  };
  /**
   * A sign-in or a permission that was done no longer applies once that
   * Company is signed out: its line goes, as what was shown with the
   * account goes from the transcript.
   */
  const over = (ask: Ask) => {
    const c = s.companies.find((x) => x.origin === ask.origin);
    return ask.phase === "done" && !!c && !c.signedIn && !c.signingIn;
  };
  for (const c of s.companies) {
    let carried = false;
    for (const kind of [...KINDS, "signing" as const]) {
      const key = keyOf(kind, c.origin);
      const before = shown.get(key);
      const now = wanted(kind, c, s) && !(kind === "signing" && carried);
      if (now && before?.phase === "done") {
        // Kept as it ended, under a key of its own.
        let n = 1;
        while (shown.has(`${key} #${n}`)) n++;
        const kept = `${key} #${n}`;
        shown.set(kept, { ...before, key: kept });
        if (arrivals.has(key)) arrivals.set(kept, arrivals.get(key)!);
        drop(key);
      }
      if (now) {
        keep({
          key,
          kind,
          origin: c.origin,
          phase: kind === "signing" ? "underway" : "open",
        });
        continue;
      }
      const latest = shown.get(key);
      if (
        latest &&
        latest.phase !== "done" &&
        kind !== "signing" &&
        kind !== "invitation" &&
        c.signingIn
      ) {
        carried = true;
        keep({ ...latest, phase: "underway" });
      } else if (latest?.phase === "done" && !over(latest)) keep(latest);
      else if (latest && done(kind, c, s))
        // How it ended, as it was then: a later permission doesn't change it.
        keep({
          ...latest,
          phase: "done",
          ended: endedWords(kind, c, s.language),
        });
      else drop(key);
    }
  }
  for (const [key, ask] of shown) {
    // A Company that left the conversation takes its asks with it.
    if (!s.companies.some((c) => c.origin === ask.origin) || over(ask))
      drop(key);
    // The ones kept as they ended.
    else if (key.includes(" #")) asks.push(ask);
  }
  return asks;
}

/** Whether an ask waits for the person, for the inbox. */
export const waitsForPerson = (ask: Ask) =>
  ask.phase === "underway" ||
  (ask.phase === "open" &&
    (ask.kind === "lost" ||
      ask.kind === "extension" ||
      ask.kind === "invitation"));
