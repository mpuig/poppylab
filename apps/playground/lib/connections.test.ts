/**
 * One conversation with two Companies. No route makes one yet, so each is
 * built here by hand: connected, talked to signed out, signed in, talked
 * to again. What happens at one Company must leave the other's alone.
 */
import { describe, expect, it } from "vitest";
import {
  addConnection,
  MAX_CONNECTIONS,
  nameFor,
  onlyConnection,
  originOf,
} from "./connections";
import { keepLines } from "./inspector-log";
import type { Connection, Operation, Run } from "./runtime";
import {
  backToPublic,
  forgetCompany,
  forgetLostAccount,
  keepPublicHistory,
  recordTurn,
  removeConnection,
  shownTranscript,
} from "./transcript";

const juniper = "https://juniper.example";
const lantern = "https://lantern.example";
const named = (name: string) =>
  ({ document: { organization: { name } } }) as Connection["company"];
const operation = (id: string, state: Operation["state"]) =>
  ({
    operation_id: id,
    revision: "r1",
    state,
    expires_at: "2030-01-01T00:00:00Z",
    request: { url: `${juniper}/api/account/${id}`, body: {} },
    ...(state === "uncertain"
      ? { approval: { approved_at: 1, reference: "apr_1" } }
      : {}),
  }) as Operation;

/** The conversation before any Company is connected. */
const empty = (): Run => ({
  protocol: "1.0",
  visitor: "visitor-fixture",
  epoch: "epoch_1",
  expires: Date.now() + 60000,
  calls: 0,
  busy: false,
  connections: [],
  history: [],
});

/**
 * Juniper and Lantern in one conversation: a question to each signed out,
 * then a sign-in and an account question at each, with proposals.
 */
function conversation() {
  const run = empty();
  const a = addConnection(run, juniper);
  a.company = named("Juniper Market")!;
  const b = addConnection(run, lantern);
  b.company = named("Lantern Noodle Bar")!;

  recordTurn(run, a, "When do you deliver?", "Tuesday and Saturday.");
  keepLines(run, a, ["GET /api/delivery · 200"], 1000);
  recordTurn(run, b, "What's on the menu?", "Ramen.");
  keepLines(run, b, ["GET /api/menu · 200"], 2000);

  // The sign-in callback, at Juniper.
  keepPublicHistory(run, a);
  a.accountToken = "refresh-juniper";
  a.sessionId = "sid-juniper";
  keepLines(run, a, ["Direct Sign-In completed · Juniper"], 3000, false);
  recordTurn(run, a, "my deliveries", "Elena's delivery is on Thursday.");
  keepLines(run, a, ["GET /api/account/deliveries · 200"], 4000);
  a.operations = {
    waiting: operation("waiting", "proposed"),
    sent: operation("sent", "uncertain"),
  };

  // And at Lantern.
  keepPublicHistory(run, b);
  b.accountToken = "refresh-lantern";
  b.sessionId = "sid-lantern";
  recordTurn(run, b, "my orders", "Order 12 for Dana.");
  keepLines(run, b, ["GET /api/account/orders · 200"], 5000);
  b.operations = { refund: operation("refund", "proposed") };
  run.title = "When do you deliver?";
  return { run, a, b };
}
const words = (run: Run) => (run.transcript ?? []).map((e) => e.content);
const lines = (run: Run) => (run.log ?? []).map((line) => line.text);
const told = (run: Run) => run.history.map((turn) => turn.content);

const juniperPublic = ["When do you deliver?", "Tuesday and Saturday."];
const juniperAccount = ["my deliveries", "Elena's delivery is on Thursday."];
const lanternPublic = ["What's on the menu?", "Ramen."];
const lanternAccount = ["my orders", "Order 12 for Dana."];

describe("what a conversation with two Companies keeps", () => {
  it("says which Company each entry, line and turn came from, and whether its account was signed in", () => {
    const { run } = conversation();
    expect(
      run.transcript!.map((e) => [e.content, e.company, !!e.signedOut]),
    ).toEqual([
      ["When do you deliver?", juniper, true],
      ["Tuesday and Saturday.", juniper, true],
      ["What's on the menu?", lantern, true],
      ["Ramen.", lantern, true],
      ["my deliveries", juniper, false],
      ["Elena's delivery is on Thursday.", juniper, false],
      ["my orders", lantern, false],
      ["Order 12 for Dana.", lantern, false],
    ]);
    expect(run.log!.map((l) => [l.text, l.company, !!l.signedOut])).toEqual([
      ["GET /api/delivery · 200", juniper, true],
      ["GET /api/menu · 200", lantern, true],
      ["Direct Sign-In completed · Juniper", juniper, true],
      ["GET /api/account/deliveries · 200", juniper, false],
      ["GET /api/account/orders · 200", lantern, false],
    ]);
    expect(run.history.map((turn) => turn.company)).toEqual([
      juniper,
      juniper,
      lantern,
      lantern,
      juniper,
      juniper,
      lantern,
      lantern,
    ]);
    // The page is answered the entries without it, as before.
    for (const entry of shownTranscript(run))
      expect(entry).not.toHaveProperty("company");
  });

  it("keeps for each Company its own turns from before its sign-in", () => {
    const { a, b } = conversation();
    expect(a.publicHistory!.map((turn) => turn.content)).toEqual(juniperPublic);
    // Lantern's sign-in came after Juniper's account turns: none of them.
    expect(b.publicHistory!.map((turn) => turn.content)).toEqual(lanternPublic);
  });
});

describe("a sign-in at one Company that may be for another account", () => {
  it("takes back what was shown with that Company's account, and nothing of the other's", () => {
    const { run, a, b } = conversation();
    const other = structuredClone(b);
    backToPublic(run, a);
    expect(words(run)).toEqual([
      ...juniperPublic,
      ...lanternPublic,
      ...lanternAccount,
    ]);
    expect(lines(run)).toEqual([
      "GET /api/delivery · 200",
      "GET /api/menu · 200",
      "Direct Sign-In completed · Juniper",
      "GET /api/account/orders · 200",
    ]);
    // The model: Juniper's turns from before its account, then the turns
    // with Lantern it still had.
    expect(told(run)).toEqual([
      ...juniperPublic,
      ...lanternPublic,
      ...lanternAccount,
    ]);
    expect(a.operations).toEqual({});
    expect(JSON.stringify([run.transcript, run.log, run.history])).not.toMatch(
      /Elena|deliveries/,
    );
    // Lantern's sign-in, proposals and public turns are as they were.
    expect(b).toEqual(other);
    expect(run.title).toBe("When do you deliver?");
  });

  it("names the conversation after the first request still shown, whichever Company it was for", () => {
    const run = empty();
    const a = addConnection(run, juniper);
    const b = addConnection(run, lantern);
    a.accountToken = "refresh-juniper";
    recordTurn(run, a, "my deliveries", "Thursday.");
    recordTurn(run, b, "What's on the menu?", "Ramen.");
    run.title = "my deliveries";
    backToPublic(run, a);
    expect(words(run)).toEqual(lanternPublic);
    expect(run.title).toBe("What's on the menu?");
  });
});

describe("an access one Company took back (§5.5)", () => {
  it("drops what was shown with that Company's account and keeps the approval whose outcome isn't known", () => {
    const { run, a, b } = conversation();
    const other = structuredClone(b);
    // Still accepted, or known already: nothing changes.
    expect(forgetLostAccount(run, a, false)).toBeUndefined();
    a.accountUnavailable = true;
    expect(forgetLostAccount(run, a, true)).toBeUndefined();
    expect(words(run)).toHaveLength(8);

    const left = forgetLostAccount(run, a, false)!;
    expect(words(run)).toEqual([
      ...juniperPublic,
      ...lanternPublic,
      ...lanternAccount,
    ]);
    // What the answer carries is that Company's: its proposals, and the
    // conversation as the page gets it.
    expect(left.operations.map((op) => op.operation_id)).toEqual(["sent"]);
    expect(left.history).toEqual(shownTranscript(run));
    expect(Object.keys(a.operations!)).toEqual(["sent"]);
    expect(a.accountToken).toBe("refresh-juniper");
    expect(b).toEqual(other);
  });

  it("leaves the other Company's lost access to that Company", () => {
    const { run, a, b } = conversation();
    b.accountUnavailable = true;
    // Asked about Juniper, whose access is fine.
    expect(forgetLostAccount(run, a, false)).toBeUndefined();
    expect(words(run)).toHaveLength(8);
    forgetLostAccount(run, b, false);
    expect(words(run)).toEqual([
      ...juniperPublic,
      ...lanternPublic,
      ...juniperAccount,
    ]);
    expect(Object.keys(a.operations!)).toEqual(["waiting", "sent"]);
    expect(b.operations).toEqual({});
  });
});

describe("a sign-out at one Company", () => {
  it("empties what the conversation holds from that Company, signed out included, and nothing of the other's", () => {
    const { run, a, b } = conversation();
    const other = structuredClone(b);
    forgetCompany(run, a);
    expect(words(run)).toEqual([...lanternPublic, ...lanternAccount]);
    expect(lines(run)).toEqual([
      "GET /api/menu · 200",
      "GET /api/account/orders · 200",
    ]);
    expect(told(run)).toEqual([...lanternPublic, ...lanternAccount]);
    expect(a.publicHistory).toBeUndefined();
    expect(b).toEqual(other);
    // History lists it under the first request it still shows.
    expect(run.title).toBe("What's on the menu?");
    for (const kept of [run.transcript!, run.log!, run.history])
      expect(kept.map((entry) => entry.company)).toEqual(
        kept.map(() => lantern),
      );
  });

  it("leaves nothing when the Company was the only one, as before", () => {
    const run = empty();
    const a = addConnection(run, juniper);
    recordTurn(run, a, "When do you deliver?", "Tuesday and Saturday.");
    keepLines(run, a, ["GET /api/delivery · 200"], 1000);
    run.title = "When do you deliver?";
    forgetCompany(run, a);
    expect(run.history).toEqual([]);
    for (const gone of ["transcript", "log", "title"])
      expect(run).not.toHaveProperty(gone);
  });
});

it("takes back what names no Company at any Company's sign-in: it can't be told whose it was", () => {
  const { run, b } = conversation();
  run.transcript!.push({ role: "assistant", content: "Which one?" });
  run.log!.push({ at: 6000, text: "No Company named" });
  run.history.push({ role: "assistant", content: "Which one?" });
  backToPublic(run, b);
  expect(words(run)).not.toContain("Which one?");
  expect(lines(run)).not.toContain("No Company named");
  expect(told(run)).not.toContain("Which one?");
  // Signed out, it stays, like the rest of what was shown signed out.
  run.transcript!.push({
    role: "assistant",
    content: "Which Company?",
    signedOut: true,
  });
  backToPublic(run, b);
  expect(words(run)).toContain("Which Company?");
});

describe("a Company removed from the conversation", () => {
  it("ends its Session and sign-in here, and keeps what was shown signed out, still saying where it came from", () => {
    const { run, a, b } = conversation();
    const other = structuredClone(b);
    removeConnection(run, a);

    expect(run.connections).toEqual([b]);
    expect(onlyConnection(run)).toBe(b);
    expect(b).toEqual(other);
    // No token, key or Session of Juniper's is left in what is stored.
    expect(JSON.stringify(run)).not.toMatch(/refresh-juniper|sid-juniper/);

    expect(words(run)).toEqual([
      ...juniperPublic,
      ...lanternPublic,
      ...lanternAccount,
    ]);
    expect(lines(run)).toEqual([
      "GET /api/delivery · 200",
      "GET /api/menu · 200",
      "Direct Sign-In completed · Juniper",
      "GET /api/account/orders · 200",
    ]);
    expect(told(run)).toEqual([
      ...juniperPublic,
      ...lanternPublic,
      ...lanternAccount,
    ]);
    expect(JSON.stringify([run.transcript, run.log, run.history])).not.toMatch(
      /Elena|deliveries/,
    );
    // What stays says where it came from, by name as well.
    expect(run.transcript!.slice(0, 2).map((e) => e.company)).toEqual([
      juniper,
      juniper,
    ]);
    expect(nameFor(run, juniper)).toBe("Juniper Market");
    expect(nameFor(run, lantern)).toBe("Lantern Noodle Bar");
    expect(nameFor(run, "https://unknown.example")).toBe("unknown.example");
  });

  it("keeps an approval whose outcome isn't known, without the request it can no longer send, and drops the proposals that waited", () => {
    const { run, a } = conversation();
    removeConnection(run, a);
    expect(run.former).toEqual([
      {
        url: juniper,
        name: "Juniper Market",
        operations: {
          sent: {
            operation_id: "sent",
            revision: "r1",
            state: "uncertain",
            expires_at: "2030-01-01T00:00:00Z",
            approval: { approved_at: 1, reference: "apr_1" },
          },
        },
      },
    ]);
  });

  it("changes nothing when the connection isn't the conversation's", () => {
    const { run, a } = conversation();
    const before = structuredClone(run);
    removeConnection(run, { ...a });
    removeConnection(run, { url: "https://other.example", user: "" });
    expect(run).toEqual(before);
  });

  it("can be connected again at any moment: signed out, with what it left still in place", () => {
    const { run, a, b } = conversation();
    removeConnection(run, a);
    removeConnection(run, b);
    expect(run.connections).toEqual([]);
    expect(run.former!.map((f) => f.name)).toEqual([
      "Juniper Market",
      "Lantern Noodle Bar",
    ]);
    const kept = structuredClone([run.transcript, run.log, run.history]);

    const again = addConnection(run, lantern);
    // Signed out and with no Session yet. The User ID is worked out for
    // this Company from the conversation's visitor (`ensureSession`).
    expect(again).toEqual({
      url: lantern,
      user: "",
      visitor: "visitor-fixture",
      epoch: "epoch_1",
    });
    expect([run.transcript, run.log, run.history]).toEqual(kept);
    // Its name comes from the connection again. Juniper's stays, with the
    // approval it left.
    expect(run.former!.map((f) => f.name)).toEqual(["Juniper Market"]);
    addConnection(run, juniper);
    expect(Object.keys(run.former![0]!.operations!)).toEqual(["sent"]);
    // What it showed signed out before it left is its own again: a
    // sign-out there empties it.
    forgetCompany(run, again);
    expect(words(run)).toEqual(juniperPublic);
  });

  it("remembers a few Companies that left, the ones with an approval out longest", () => {
    const run = empty();
    const leave = (host: string, operations?: Connection["operations"]) => {
      const c = addConnection(run, `https://${host}.example`);
      if (operations) c.operations = operations;
      removeConnection(run, c);
    };
    leave("first", { sent: operation("sent", "uncertain") });
    for (let i = 0; i < 10; i++) leave(`company-${i}`);
    expect(run.former).toHaveLength(8);
    expect(run.former![0]!.name).toBe("first.example");
    expect(run.former!.at(-1)!.name).toBe("company-9.example");
    // Removed again with nothing new, it keeps the approval it left before.
    leave("first");
    expect(run.former!.at(-1)).toMatchObject({
      name: "first.example",
      operations: { sent: { state: "uncertain" } },
    });
  });
});

describe("connecting a Company to a conversation", () => {
  it("adds one at any moment, signed out, and leaves what the conversation holds as it is", () => {
    const run = empty();
    const a = addConnection(run, juniper);
    a.accountToken = "refresh-juniper";
    recordTurn(run, a, "my deliveries", "Thursday.");
    const before = structuredClone([run.transcript, run.history, a]);
    const b = addConnection(run, `${lantern}/menu`);
    expect(run.connections).toEqual([a, b]);
    expect(b).toEqual({
      url: `${lantern}/menu`,
      user: "",
      visitor: "visitor-fixture",
      epoch: "epoch_1",
    });
    expect(originOf(b)).toBe(lantern);
    expect([run.transcript, run.history, a]).toEqual(before);
  });

  it("holds each Company once, and three at most", () => {
    const run = empty();
    addConnection(run, juniper);
    // The origin names the Company, whatever the rest of the address.
    expect(() => addConnection(run, `${juniper}/shop`)).toThrow(
      "already connected",
    );
    addConnection(run, lantern);
    addConnection(run, "https://harborline.example");
    expect(run.connections).toHaveLength(MAX_CONNECTIONS);
    expect(() => addConnection(run, "https://fernwick.example")).toThrow(
      "three Companies",
    );
    // The routes that take a conversation's one connection say so here.
    expect(() => onlyConnection(run)).toThrow("Expected one connection");
    expect(() => onlyConnection(empty())).toThrow("Expected one connection");
  });
});
