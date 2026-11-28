import { describe, expect, it } from "vitest";
import { discovered } from "@poppy-lab/pap-agent/company-fixture";
import { lanternUrl, type Message } from "./companies";
import { companyFromView, type CompanyState } from "./company-state";
import {
  endedWords,
  nextAsks,
  waitsForPerson,
  type Ask,
  type AskState,
} from "./asks";
import { focusGoesBack, type Focused } from "./focus-return";
import { inboxItems } from "./pending-inbox";
import { askOfChoices } from "./conversation";
import {
  cardId,
  placeRows,
  proposalKey,
  type Arrivals,
} from "./transcript-items";

const lantern = new URL(lanternUrl).origin;
const said = (text: string): Message => ({ role: "You", text });
const rowsOf = (
  messages: Message[],
  keys: string[],
  arrivals: Arrivals = new Map(),
) =>
  placeRows(
    messages,
    keys.map((key) => ({ key })),
    arrivals,
  ).map((row) => (row.kind === "message" ? row.index : row.key));

describe("where a card goes in the transcript", () => {
  const key = proposalKey(lantern, "op_1");
  const question: Message = {
    role: "Own",
    text: "Lantern Noodle Bar proposes a change. Approve it?",
    proposals: [{ company: lantern, proposal: "op_1", revision: "r1" }],
  };

  it("follows the message the proposal arrived with, and stays there", () => {
    const messages = [said("change my order"), question];
    expect(rowsOf(messages, [key])).toEqual([0, 1, key]);
    // Decided, then more is said: the card stays where it arrived.
    const later = [...messages, said("connect with fernwick"), said("plans")];
    expect(rowsOf(later, [key])).toEqual([0, 1, key, 2, 3]);
  });

  it("follows new terms for the same proposal where they arrived", () => {
    const again: Message = { ...question, text: "New terms. Approve them?" };
    expect(rowsOf([said("a"), question, said("yes"), again], [key])).toEqual([
      0,
      1,
      2,
      3,
      key,
    ]);
  });

  it("places one no message names where the page first saw it, and keeps it there", () => {
    const arrivals: Arrivals = new Map();
    const first = [said("a"), said("b")];
    expect(rowsOf(first, [key], arrivals)).toEqual([0, 1, key]);
    expect(rowsOf([...first, said("c")], [key], arrivals)).toEqual([
      0,
      1,
      key,
      2,
    ]);
    // Before any message, it opens the transcript.
    expect(rowsOf([], ["ask"], new Map())).toEqual(["ask"]);
    // What the page showed was taken back: never past the end.
    expect(rowsOf([said("a")], [key], arrivals)).toEqual([0, key]);
  });

  it("gives each card an element ID from its Company and ID", () => {
    expect(cardId(key)).toBe("proposal-noodles-localhost-4200-op_1");
  });
});

describe("asks about an account", () => {
  const company = (more: Partial<CompanyState> = {}): CompanyState => ({
    ...companyFromView({
      origin: lantern,
      name: "Lantern Noodle Bar",
      company: discovered(lantern, "Lantern Noodle Bar"),
    }),
    ...more,
  });
  const state = (c: CompanyState, step = 1): AskState => ({
    companies: [c],
    guide: { origin: lantern, step },
    moreAccess: () => true,
    extensionSignIn: () => false,
    offersSignIn: () => true,
    askedAt: () => false,
    readOnly: false,
  });
  const phases = (asks: Ask[]) => asks.map((a) => `${a.kind}:${a.phase}`);

  it("goes from the guide's suggestion, to a sign-in under way, to how it ended", () => {
    const shown = new Map<string, Ask>();
    const arrivals: Arrivals = new Map();
    expect(phases(nextAsks(state(company()), shown, arrivals))).toEqual([
      "signin:open",
    ]);
    const signing = company({
      signingIn: { baseline: 0, since: 0, access: "read" },
    });
    const underway = nextAsks(state(signing), shown, arrivals);
    expect(phases(underway)).toEqual(["signin:underway"]);
    expect(underway.every(waitsForPerson)).toBe(true);
    const done = company({ signedIn: true, scopes: "poppy:read" });
    // Signed in read only: the sign-in folds, and change permission is
    // the next suggestion, at a point of its own.
    expect(phases(nextAsks(state(done, 2), shown, arrivals))).toEqual([
      "signin:done",
      "write:open",
    ]);
  });

  it("says how a sign-in and a change permission ended in the conversation's language, and drops both at sign-out", () => {
    const shown = new Map<string, Ask>();
    const arrivals: Arrivals = new Map();
    const es = (c: CompanyState, step: number) => ({
      ...state(c, step),
      language: "es" as const,
    });
    nextAsks(es(company(), 1), shown, arrivals);
    nextAsks(
      es(company({ signingIn: { baseline: 0, since: 0, access: "read" } }), 1),
      shown,
      arrivals,
    );
    const done = company({ signedIn: true, scopes: "poppy:read" });
    const ended = nextAsks(es(done, 2), shown, arrivals);
    expect(ended.find((a) => a.phase === "done")?.ended).toBe(
      "Sesión iniciada en Lantern Noodle Bar · solo lectura",
    );
    expect(endedWords("write", done, "es")).toBe(
      "Permiso de cambios dado en Lantern Noodle Bar",
    );
    // Signed out from the Companies bar: it no longer applies.
    const out = nextAsks(es(company(), 2), shown, arrivals);
    expect(out.some((a) => a.phase === "done")).toBe(false);
    expect([...shown.values()].some((a) => a.phase === "done")).toBe(false);
  });

  it("drops a suggestion nobody took once it is no longer made", () => {
    const shown = new Map<string, Ask>();
    const arrivals: Arrivals = new Map([["ask signin x", 0]]);
    nextAsks(state(company()), shown, arrivals);
    arrivals.set(`ask signin ${lantern}`, 3);
    expect(nextAsks(state(company(), 3), shown, arrivals)).toEqual([]);
    expect(arrivals.has(`ask signin ${lantern}`)).toBe(false);
  });

  it("lists a sign-in to do again as waiting for the person, and not the guide's suggestions", () => {
    const shown = new Map<string, Ask>();
    const lost = nextAsks(
      state(company({ recovery: "access_denied" })),
      shown,
      new Map(),
    );
    expect(phases(lost)).toEqual(["lost:open"]);
    expect(lost.every(waitsForPerson)).toBe(true);
    const suggested = nextAsks(state(company()), new Map(), new Map());
    expect(suggested.some(waitsForPerson)).toBe(false);
  });

  it("asks nothing where Iris's question asks it already, or once the conversation ended", () => {
    expect(
      nextAsks(
        { ...state(company()), askedAt: () => true },
        new Map(),
        new Map(),
      ),
    ).toEqual([]);
    expect(
      nextAsks({ ...state(company()), readOnly: true }, new Map(), new Map()),
    ).toEqual([]);
  });
});

describe("the message box's focus", () => {
  const at = (tagName: string, ...inside: string[]): Focused => ({
    tagName,
    closest: (selector: string) =>
      selector
        .split(",")
        .map((s) => s.trim())
        .some((s) => inside.includes(s) || s.toUpperCase() === tagName)
        ? {}
        : null,
  });

  it("goes back after a send, a quick reply or a decision, when the focus went nowhere", () => {
    // The box was disabled while the turn ran: the focus fell to the page.
    expect(focusGoesBack(null)).toBe(true);
    expect(focusGoesBack(at("BODY"))).toBe(true);
    // Still on the send button, or on the button that was pressed.
    expect(focusGoesBack(at("BUTTON", ".composer"))).toBe(true);
    expect(focusGoesBack(at("BUTTON", ".message-choices"))).toBe(true);
    expect(focusGoesBack(at("BUTTON", ".operation-actions"))).toBe(true);
  });

  it("stays where the person put it on purpose", () => {
    expect(focusGoesBack(at("INPUT"))).toBe(false);
    expect(focusGoesBack(at("SELECT"))).toBe(false);
    expect(focusGoesBack(at("BUTTON", ".pending-inbox"))).toBe(false);
    expect(focusGoesBack(at("A"))).toBe(false);
    // A sign-in tab has the focus.
    expect(focusGoesBack(at("BODY"), false)).toBe(false);
  });
});

describe("the inbox", () => {
  it("reads Iris's open question from its buttons", () => {
    expect(
      askOfChoices([
        {
          label: "Sign in",
          answer: { signin: { company: lantern, access: "read" } },
        },
      ]),
    ).toEqual({ signin: { company: lantern, access: "read" } });
    expect(
      askOfChoices([{ label: "Yes, go on", answer: { resume: lantern } }]),
    ).toEqual({ resume: lantern });
    expect(
      askOfChoices([{ label: "Lantern", answer: { company: lantern } }]),
    ).toEqual({ which: true });
    // A proposal's buttons: its card lists it, not the question.
    expect(
      askOfChoices([
        {
          label: "Approve",
          answer: {
            approve: { company: lantern, proposal: "op", revision: "r" },
          },
        },
      ]),
    ).toBeUndefined();
  });

  it("lists this conversation's first, then the others', without what ran out", () => {
    const now = Date.parse("2026-11-27T12:00:00Z");
    const item = (conversation: string, expiresAt?: string) => ({
      conversation,
      kind: "proposal" as const,
      text: "Approve or decline the change",
      ...(expiresAt ? { expiresAt } : {}),
    });
    expect(
      inboxItems(
        [{ ...item("here"), target: "proposal-x" }],
        [
          item("other", "2026-11-27T12:05:00Z"),
          item("gone", "2026-11-27T11:59:00Z"),
        ],
        now,
      ).map((i) => i.conversation),
    ).toEqual(["here", "other"]);
  });

  it("counts only what waits: no question or sign-in left in another conversation", () => {
    const now = Date.parse("2026-11-27T12:00:00Z");
    // Two conversations left for this one, each with Iris's question open.
    const left = [
      {
        conversation: "earlier",
        kind: "signin" as const,
        text: "Sign in, read only, to go on",
      },
      {
        conversation: "before",
        kind: "question" as const,
        text: "Say whether to go on with your request",
        expiresAt: "2026-11-27T12:20:00Z",
      },
    ];
    const proposal = {
      conversation: "here",
      kind: "proposal" as const,
      text: "Approve or decline the $43.00 change",
      expiresAt: "2026-11-27T12:10:00Z",
      target: "proposal-x",
    };
    expect(inboxItems([proposal], left, now)).toHaveLength(1);
    // Approved: nothing waits, whatever the others left open.
    expect(inboxItems([], left, now)).toEqual([]);
  });
});
