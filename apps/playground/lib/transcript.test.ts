import { describe, expect, it } from "vitest";
import type { CompanyEntry } from "./conversations";
import { onlyConnection as at, untagged } from "./connections";
import type { Connection, Run, Turn } from "./runtime";
import * as transcript from "./transcript";
import { keepSignedOutTranscript, TRANSCRIPT_LIMITS } from "./transcript";

/** A conversation with one Company, signed out unless the test says so. */
const started = (connection: Partial<Connection> = {}): Run => ({
  expires: Date.now() + 60000,
  calls: 0,
  busy: false,
  history: [],
  connections: [{ url: "https://company.example", user: "", ...connection }],
});
// The functions under test, each for the conversation's one Company.
const record = (r: Run, ...turns: Turn[]) =>
  transcript.record(r, at(r), ...turns);
const recordTurn = (
  r: Run,
  said: string,
  answer: string,
  shown?: transcript.Shown,
) => transcript.recordTurn(r, at(r), said, answer, shown);
const recordDirect = (
  r: Run,
  ...rest: Parameters<typeof transcript.recordDirect> extends [
    Run,
    Connection,
    ...infer Rest,
  ]
    ? Rest
    : never
) => transcript.recordDirect(r, at(r), ...rest);
const recordOutcome = (
  r: Run,
  ...rest: Parameters<typeof transcript.recordOutcome> extends [
    Run,
    Connection,
    ...infer Rest,
  ]
    ? Rest
    : never
) => transcript.recordOutcome(r, at(r), ...rest);
const forgetLostAccount = (r: Run, knewBefore: boolean) =>
  transcript.forgetLostAccount(r, at(r), knewBefore);

/** Signed in, as most of a conversation is. */
const run = () => started({ accountToken: "held" });
const company = "Lantern Noodle Bar";
const opened = `You're talking with ${company} directly.`;
const secret = "My door code is 4417, leave it inside";
/** Everything a model turn after this one would be sent. */
const forModel = (r: Run) => JSON.stringify(r.history);
/** The model's turns as it is sent them: each a role and its words. */
const told = (r: Run) => untagged(r.history);
/** The transcript as the page gets it. */
const onPage = (r: Run) => transcript.shownTranscript(r);
const forPage = (r: Run) => (r.transcript ?? []).map((turn) => turn.content);

describe("what a Direct Conversation leaves behind (§8.10)", () => {
  it("keeps what the User said to the Company from the model", () => {
    const r = run();
    record(
      r,
      { role: "user", content: "My order never arrived" },
      { role: "assistant", content: "Lantern asks to talk with you." },
    );
    recordDirect(
      r,
      company,
      "accept",
      "Talk to the Company directly",
      opened,
      false,
    );
    recordDirect(r, company, "say", secret, "", true);
    recordDirect(
      r,
      company,
      "close",
      "Leave the direct conversation",
      "Left.",
      false,
    );

    expect(forModel(r)).not.toContain("4417");
    expect(forModel(r)).not.toContain("door code");
    // The model still learns that the User talked with the Company.
    expect(r.history.map((turn) => turn.content)).toEqual([
      "My order never arrived",
      "Lantern asks to talk with you.",
      `(Direct conversation with ${company}: accept)`,
      opened,
      `(Direct conversation with ${company}: close)`,
      "Left.",
    ]);
  });

  it("keeps the words that start one from the model too", () => {
    const r = run();
    recordDirect(r, company, "start", secret, opened, true);

    expect(forModel(r)).not.toContain("4417");
    expect(told(r)).toEqual([
      {
        role: "user",
        content: `(The user wrote to ${company} directly, without Iris.)`,
      },
      { role: "assistant", content: opened },
    ]);
  });

  it("tells the model what Iris answered, without the User's words", () => {
    const r = run();
    const over = "That direct conversation is over, so nothing was sent.";
    recordDirect(r, company, "say", secret, over, false);

    expect(forModel(r)).not.toContain("4417");
    expect(told(r).at(-1)).toEqual({ role: "assistant", content: over });
  });

  it("doesn't say the User wrote to the Company when their words may not have been sent", () => {
    const notes = {
      start: `A direct conversation with ${company} was already open, and Iris had lost track of it. You're back in it now. This message wasn't sent: say it again if ${company} doesn't have it yet.`,
      say: "This direct conversation needs you signed in, so nothing was sent. Use the Sign in control in the chat, then try again.",
    } as const;
    for (const action of ["start", "say"] as const) {
      const r = run();
      recordDirect(r, company, action, secret, notes[action], false);

      expect(forModel(r)).not.toContain("4417");
      expect(told(r)).toEqual([
        {
          role: "user",
          content: `(The user tried to write to ${company} directly, without Iris; it may not have been sent.)`,
        },
        { role: "assistant", content: notes[action] },
      ]);
      // The page shows their words as it did, then Iris's line that says
      // they weren't sent.
      expect(onPage(r)).toEqual([
        { role: "user", content: secret, direct: true },
        { role: "assistant", content: notes[action] },
      ]);
    }
  });

  it("shows the User their own words again after a reload", () => {
    const r = run();
    record(
      r,
      { role: "user", content: "My order never arrived" },
      { role: "assistant", content: "Lantern asks to talk with you." },
    );
    recordDirect(r, company, "start", "It was order 12", opened, true);
    recordDirect(r, company, "say", secret, "", true);

    // As what they are: the User's own direct lines, with no note written
    // for the model, and no line of Iris's where Iris said nothing.
    expect(onPage(r)).toEqual([
      { role: "user", content: "My order never arrived" },
      { role: "assistant", content: "Lantern asks to talk with you." },
      { role: "user", content: "It was order 12", direct: true },
      { role: "assistant", content: opened },
      { role: "user", content: secret, direct: true },
    ]);
  });

  it("keeps a button as Iris's line about it, not as words of the User's", () => {
    const r = run();
    for (const action of ["accept", "decline", "close"] as const)
      recordDirect(r, company, action, `Button: ${action}`, opened, false);

    expect(forPage(r)).toEqual([opened, opened, opened]);
    expect(JSON.stringify(r.transcript)).not.toContain("Button");
    // The model still learns what the User chose.
    expect(told(r).filter((turn) => turn.role === "user")).toEqual(
      ["accept", "decline", "close"].map((action) => ({
        role: "user",
        content: `(Direct conversation with ${company}: ${action})`,
      })),
    );
  });

  it("leaves the model's earlier turns in place while the User talks", () => {
    const r = run();
    record(
      r,
      { role: "user", content: "My order never arrived" },
      { role: "assistant", content: "Lantern asks to talk with you." },
    );
    for (let line = 0; line < 8; line++)
      recordDirect(r, company, "say", `line ${line}`, "", true);

    // The route cuts the history to its last ten after every turn.
    expect(r.history.slice(-10)[0]?.content).toBe("My order never arrived");
    expect(r.transcript).toHaveLength(10);
  });
});

describe("what the page shows again after a reload", () => {
  const menu = { items: [{ name: "Shoyu ramen", price_cents: 1400 }] };
  const said: CompanyEntry = {
    author: `${company} · automated agent`,
    human: false,
    text: "Which order is it?",
    data: JSON.stringify({ orders: ["ord_LNB0907"] }),
    note: "Proposed an operation: approve or decline it below.",
  };
  const trace = [
    "Poppy 1.0 Session signed in",
    "GET https://food.example/api/menu?access_token=tok_secret_1 · 200",
    "Conversation message · cnv_1",
  ];
  const turn = (r: Run) =>
    recordTurn(r, "What's on the menu?", "Protocol demo (no LLM). Ramen.", {
      company: [said],
      trace,
      demo: true,
      data: JSON.stringify(menu),
    });

  it("keeps Company content, and each answer's label, steps and data", () => {
    const r = run();
    turn(r);
    expect(onPage(r)).toEqual([
      { role: "user", content: "What's on the menu?" },
      {
        role: "company",
        content: "Which order is it?",
        author: `${company} · automated agent`,
        data: said.data,
        note: said.note,
      },
      {
        role: "assistant",
        content: "Protocol demo (no LLM). Ramen.",
        demo: true,
        steps: [
          {
            text: "Started a Poppy Session, signed in",
            how: "setup",
            access: null,
            state: "done",
          },
          {
            text: "Read https://food.example/api/menu",
            how: "API",
            access: "view",
            state: "done",
          },
          {
            text: "Talked to the Company's own agent",
            how: "Company's agent",
            access: null,
            state: "done",
          },
        ],
        data: JSON.stringify(menu),
      },
    ]);
  });

  it("sends the model the two turns' words and nothing else", () => {
    const r = run();
    turn(r);
    recordDirect(r, company, "start", secret, opened, true, {
      company: [{ ...said, text: "A person is here now.", direct: true }],
      trace,
    });
    recordDirect(r, company, "say", "yes", "", true, {
      company: [{ ...said, text: "Refund it is.", direct: true }],
      trace,
    });

    // Exactly a role and its words: no steps, data, label or author.
    expect(told(r)).toEqual([
      { role: "user", content: "What's on the menu?" },
      { role: "assistant", content: "Protocol demo (no LLM). Ramen." },
      {
        role: "user",
        content: `(The user wrote to ${company} directly, without Iris.)`,
      },
      { role: "assistant", content: opened },
    ]);
    // No Company content, in a conversation of Iris's or the User's own,
    // and none of the User's direct words.
    for (const theirs of [
      "Which order",
      "ord_LNB0907",
      "A person is here",
      "Refund it is",
      "4417",
      "Shoyu",
    ])
      expect(forModel(r)).not.toContain(theirs);
    // The page has them, each said where it was said.
    expect(
      r.transcript!.map((e) => [e.role, e.content, e.direct ?? false]),
    ).toEqual([
      ["user", "What's on the menu?", false],
      ["company", "Which order is it?", false],
      ["assistant", "Protocol demo (no LLM). Ramen.", false],
      ["user", secret, true],
      ["company", "A person is here now.", true],
      ["assistant", opened, false],
      ["user", "yes", true],
      ["company", "Refund it is.", true],
    ]);
  });

  it("holds no secrets: only what was on screen", () => {
    const r = started({
      accountToken: "refresh_secret",
      token: "access_secret",
      dpop: { d: "private_key_secret" },
      sessionKey: { privateKey: "session_secret" },
    } as unknown as Connection);
    turn(r);
    const stored = JSON.stringify(r.transcript);
    for (const hidden of [
      "refresh_secret",
      "access_secret",
      "private_key_secret",
      "session_secret",
      // A trace line's address is kept without its query.
      "tok_secret_1",
      "access_token",
      "Authorization",
      "DPoP",
    ])
      expect(stored).not.toContain(hidden);
  });

  it("bounds each entry", () => {
    const r = run();
    recordTurn(r, "q", "a".repeat(50_000), {
      trace: Array.from(
        { length: 200 },
        (_, i) => `step ${i} ${"x".repeat(900)}`,
      ),
      company: [{ ...said, note: "n".repeat(5000) }],
      // Larger than the page is ever sent: left out, not cut mid-JSON.
      data: JSON.stringify({ big: "d".repeat(TRANSCRIPT_LIMITS.data) }),
    });
    const [, companyEntry, answer] = r.transcript!;
    expect(answer!.content).toHaveLength(TRANSCRIPT_LIMITS.text);
    expect(answer!.steps).toHaveLength(TRANSCRIPT_LIMITS.steps);
    expect(answer!.steps![0]!.text.length).toBeLessThanOrEqual(300);
    expect(answer).not.toHaveProperty("data");
    expect(companyEntry!.note!.length).toBeLessThanOrEqual(600);
  });

  it("bounds the whole transcript, dropping the oldest data first", () => {
    const r = run();
    const bytes = () =>
      new TextEncoder().encode(JSON.stringify(r.transcript)).length;
    // Twenty turns, the most a run has, each with all the data it can show.
    for (let i = 0; i < 20; i++)
      recordTurn(r, `question ${i}`, `answer ${i}`, {
        trace,
        company: [{ ...said, data: JSON.stringify({ pad: "c".repeat(3900) }) }],
        data: JSON.stringify({ i, pad: "é".repeat(9000) }),
      });
    expect(bytes()).toBeLessThanOrEqual(TRANSCRIPT_LIMITS.bytes);
    // Every word of the conversation is still there…
    expect(forPage(r).filter((c) => c.startsWith("question"))).toHaveLength(20);
    const answers = r.transcript!.filter((e) => e.role === "assistant");
    // …the newest answers have their data, and the oldest have lost it.
    expect(answers.at(-1)).toHaveProperty("data");
    expect(answers[0]).not.toHaveProperty("data");
    expect(answers[0]).toHaveProperty("steps");

    // Far more than fits: the oldest entries go, the newest stay.
    for (let i = 0; i < 400; i++)
      recordTurn(r, `later ${i}`, "w".repeat(TRANSCRIPT_LIMITS.text));
    expect(bytes()).toBeLessThanOrEqual(TRANSCRIPT_LIMITS.bytes);
    expect(r.transcript!.length).toBeLessThanOrEqual(TRANSCRIPT_LIMITS.entries);
    expect(forPage(r)).not.toContain("question 0");
    expect(forPage(r)).toContain("later 399");
  });

  it("tells the model how an approval ended, and adds no line the page never showed", () => {
    const r = run();
    turn(r);
    const before = structuredClone(r.transcript);
    const succeeded =
      "Company operation succeeded: Refunded USD 37.00 for order ord_LNB0907.";
    const declined = "Company declined the approval; nothing was performed.";
    recordOutcome(r, {}, "performed", succeeded);
    recordOutcome(r, {}, "declined", declined);
    recordOutcome(r, { direct: true }, "performed", succeeded);

    // The page showed each on the operation's own entry, which it gets
    // again with the run's operations: no line of Iris's said it.
    expect(r.transcript).toEqual(before);
    expect(told(r).slice(2)).toEqual([
      { role: "assistant", content: succeeded },
      { role: "assistant", content: declined },
      {
        role: "assistant",
        content:
          "(An operation proposed in the user's direct conversation with the Company was approved and performed.)",
      },
    ]);
  });

  it("doesn't restore the model's line where no transcript was kept yet", () => {
    // Stored before the transcript: the page restores the model's turns.
    const r = run();
    r.history.push(
      { role: "user", content: "Refund my order" },
      { role: "assistant", content: "Lantern proposes a refund." },
    );
    recordOutcome(r, {}, "performed", "Company operation succeeded: Refunded.");
    expect(forPage(r)).toEqual([
      "Refund my order",
      "Lantern proposes a refund.",
    ]);
    expect(r.history).toHaveLength(3);
  });

  it("goes on from a transcript stored before, which had words only", () => {
    const r = run();
    r.transcript = [
      {
        role: "user",
        content: `(Said to ${company} directly, without Iris) hi`,
      },
      { role: "assistant", content: "An earlier answer." },
    ];
    turn(r);
    expect(r.transcript.slice(0, 2)).toEqual([
      {
        role: "user",
        content: `(Said to ${company} directly, without Iris) hi`,
      },
      { role: "assistant", content: "An earlier answer." },
    ]);
    expect(r.transcript).toHaveLength(5);
  });
});

describe("what a sign-in keeps of the transcript", () => {
  const signedOut = () => started();
  const shown = (r: Run) => (r.transcript ?? []).map((entry) => entry.content);

  it("keeps what was shown before any account access, as it was shown", () => {
    const r = signedOut();
    recordTurn(r, "When do you deliver?", "Tuesday and Saturday.", {
      company: [{ author: company, human: false, text: "Any day but Sunday." }],
      trace: ["Conversation started"],
      demo: true,
      data: '{"days":2}',
    });
    at(r).accountToken = "first-account";
    recordTurn(r, "my orders", "Order ord_PRIVATE_1 for Elena.", {
      company: [{ author: company, human: false, text: "ord_PRIVATE_2" }],
      data: '{"order":"ord_PRIVATE_3"}',
    });
    recordDirect(r, company, "start", "my card ends 4417", "In.", true);
    recordOutcome(r, {}, "performed", "Company operation succeeded: PRIVATE_4");

    keepSignedOutTranscript(r, at(r));
    expect(shown(r)).toEqual([
      "When do you deliver?",
      "Any day but Sunday.",
      "Tuesday and Saturday.",
    ]);
    expect(r.transcript!.at(-1)).toMatchObject({
      demo: true,
      data: '{"days":2}',
      steps: [{ text: "Talked to the Company's own agent" }],
    });
    // Nothing shown with the account survives: it may be another's now.
    expect(JSON.stringify(r.transcript)).not.toMatch(/PRIVATE|4417|In\./);
  });

  it("drops a transcript that doesn't say what was shown signed out", () => {
    const r = signedOut();
    // Stored before entries said so: any of it may be an account's.
    r.transcript = [
      { role: "user", content: "When do you deliver?" },
      { role: "assistant", content: "Private order details" },
    ];
    keepSignedOutTranscript(r, at(r));
    expect(r).not.toHaveProperty("transcript");

    // The same when everything was shown signed in.
    at(r).accountToken = "held";
    recordTurn(r, "my orders", "Private order details");
    keepSignedOutTranscript(r, at(r));
    expect(r).not.toHaveProperty("transcript");
  });

  it("names the conversation after the first request still shown, or not at all", () => {
    // History lists it under `title`: the first request, as the chat sets it.
    const r = signedOut();
    at(r).accountToken = "first-account";
    r.title = "Show my orders";
    recordTurn(r, "Show my orders", "Order ord_PRIVATE_1 for Elena.");
    // The model's turns go back to the public ones first: none here.
    r.history = [];
    keepSignedOutTranscript(r, at(r));
    // Nothing of it is left to open, so no words of it are listed either.
    expect(r).not.toHaveProperty("title");

    const later = signedOut();
    recordDirect(later, company, "start", "hello there", opened, true);
    recordTurn(later, "  When do you deliver?", "Tuesday and Saturday.");
    at(later).accountToken = "first-account";
    later.title = "Show my orders";
    recordTurn(later, "Show my orders", "Order ord_PRIVATE_1 for Elena.");
    keepSignedOutTranscript(later, at(later));
    // Not words said to the Company in a Direct Conversation.
    expect(later.title).toBe("When do you deliver?");
  });
});

describe("what stays when the Company takes the access back (§5.5)", () => {
  const shown = (r: Run) => (r.transcript ?? []).map((entry) => entry.content);
  /** Asked signed out, then signed in, with two proposals from the account. */
  const conversation = () => {
    const r = started();
    recordTurn(r, "When do you deliver?", "Tuesday and Saturday.");
    at(r).publicHistory = structuredClone(r.history);
    at(r).accountToken = "refresh";
    recordTurn(r, "my deliveries", "Elena's delivery is on Thursday.", {
      data: '{"customer":"Elena Maren"}',
    });
    at(r).operations = {
      waiting: { operation_id: "waiting", state: "proposed" },
      sent: { operation_id: "sent", state: "uncertain" },
    } as unknown as NonNullable<Connection["operations"]>;
    return r;
  };

  it("drops what was shown with the account, once, and keeps what was shown signed out", () => {
    const r = conversation();
    // Still accepted: nothing changes.
    expect(forgetLostAccount(r, false)).toBeUndefined();
    expect(shown(r)).toHaveLength(4);

    at(r).accountUnavailable = true;
    const left = forgetLostAccount(r, false);
    expect(shown(r)).toEqual(["When do you deliver?", "Tuesday and Saturday."]);
    expect(r.history).toEqual(at(r).publicHistory);
    // What the answer carries for the page is what a reload would show.
    expect(left).toEqual({
      history: onPage(r),
      operations: [{ operation_id: "sent", state: "uncertain" }],
    });
    // An approval that is out may have been performed: it stays, so the
    // same one can be retried. A proposal that only waited goes.
    expect(Object.keys(at(r).operations!)).toEqual(["sent"]);
    expect(JSON.stringify([r.transcript, r.history])).not.toContain("Elena");
    // The sign-in is kept, to be revoked or replaced at the next one.
    expect(at(r).accountToken).toBe("refresh");

    // Iris knew already: what is said next is not taken back.
    recordTurn(r, "What do you sell?", "Oranges.");
    expect(forgetLostAccount(r, true)).toBeUndefined();
    expect(shown(r)).toHaveLength(4);
  });

  it("leaves a conversation that never had an account alone", () => {
    const r = started();
    recordTurn(r, "When do you deliver?", "Tuesday and Saturday.");
    // A refused signed-out Session sets the same mark.
    at(r).accountUnavailable = true;
    expect(forgetLostAccount(r, false)).toBeUndefined();
    expect(r.history).toHaveLength(2);
  });
});
