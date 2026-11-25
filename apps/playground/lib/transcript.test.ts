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
    recordDirect(r, company, "accept", "Talk to the Company directly", opened);
    recordDirect(r, company, "say", secret, "");
    recordDirect(r, company, "close", "Leave the direct conversation", "Left.");

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
    recordDirect(r, company, "start", secret, opened);

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
    recordDirect(r, company, "say", secret, over);

    expect(forModel(r)).not.toContain("4417");
    expect(r.history.at(-1)).toEqual({ role: "assistant", content: over });
  });

  it("shows the User their own words again after a reload", () => {
    const r = run();
    record(
      r,
      { role: "user", content: "My order never arrived" },
      { role: "assistant", content: "Lantern asks to talk with you." },
    );
    recordDirect(r, company, "start", "It was order 12", opened);
    recordDirect(r, company, "say", secret, "");

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
      recordDirect(r, company, "say", `line ${line}`, "");

    // The route cuts the history to its last ten after every turn.
    expect(r.history.slice(-10)[0]?.content).toBe("My order never arrived");
    expect(r.transcript).toHaveLength(18);
  });
});
