import { describe, expect, it } from "vitest";
import type { Run } from "./runtime";
import { record, recordDirect } from "./transcript";

const run = () => ({ history: [] }) as unknown as Run;
const company = "Lantern Noodle Bar";
const opened = `You're talking with ${company} directly.`;
const secret = "My door code is 4417, leave it inside";
/** Everything a model turn after this one would be sent. */
const forModel = (r: Run) => JSON.stringify(r.history);
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
    expect(r.history).toEqual([
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
    expect(r.history.at(-1)).toEqual({ role: "assistant", content: over });
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
      expect(r.history).toEqual([
        {
          role: "user",
          content: `(The user tried to write to ${company} directly, without Iris; it may not have been sent.)`,
        },
        { role: "assistant", content: notes[action] },
      ]);
      // The page still shows the words, and not as said to the Company.
      expect(forPage(r)).toEqual([
        `(Written to ${company} directly, without Iris; it may not have been sent) ${secret}`,
        notes[action],
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

    expect(forPage(r)).toEqual([
      "My order never arrived",
      "Lantern asks to talk with you.",
      `(Said to ${company} directly, without Iris) It was order 12`,
      opened,
      `(Said to ${company} directly, without Iris) ${secret}`,
      "(No reply from Iris: the user was talking with the Company directly.)",
    ]);
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
    expect(r.transcript).toHaveLength(18);
  });
});
