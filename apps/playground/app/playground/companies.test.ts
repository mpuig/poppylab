import { describe, expect, it } from "vitest";
import type { Connection, Run } from "@/lib/runtime";
import { recordDirect, recordTurn } from "@/lib/transcript";
import { historyToMessages } from "./companies";

const company = "Lantern Noodle Bar";
const agent = `${company} · automated agent`;

describe("a conversation restored from its transcript", () => {
  it("shows what the page showed: Company content, labels, steps and data", () => {
    const connection = { accountToken: "held" } as unknown as Connection;
    const run = { history: [], connections: [connection] } as unknown as Run;
    recordTurn(
      run,
      connection,
      "My order never arrived",
      "Protocol demo (no LLM). Told.",
      {
        company: [
          { author: agent, human: false, text: "Sorry to hear that." },
          {
            author: company,
            human: false,
            note: "Asks to talk with you directly.",
            invitation: true,
          },
        ],
        trace: ["Conversation started"],
        demo: true,
        data: '{"replies":1}',
      },
    );
    recordDirect(
      run,
      connection,
      company,
      "accept",
      "Talk to the Company directly",
      "In.",
      false,
      {
        company: [
          {
            author: agent,
            human: false,
            text: "Shall we refund it?",
            direct: true,
          },
        ],
        trace: ["Direct Conversation · accepting the Company's invitation"],
      },
    );
    recordDirect(run, connection, company, "say", "yes", "", true, {
      company: [
        {
          author: agent,
          human: false,
          text: "Here is the refund.",
          data: '{"refund_cents":3700}',
          note: "Proposed an operation: approve or decline it below.",
          direct: true,
        },
      ],
    });
    recordTurn(run, connection, "Thanks", "You're welcome.", { trace: [] });

    // Through JSON, as the page gets it from GET /api/account.
    const messages = historyToMessages(
      JSON.parse(JSON.stringify(run.transcript)),
    );
    expect(messages).toEqual([
      { role: "You", text: "My order never arrived" },
      { role: "Company", author: agent, text: "Sorry to hear that." },
      {
        role: "Company",
        author: company,
        text: "",
        note: "Asks to talk with you directly.",
      },
      {
        role: "Demo",
        text: "Protocol demo (no LLM). Told.",
        data: '{"replies":1}',
        steps: [
          {
            text: "Talked to the Company's own agent",
            how: "Company's agent",
            access: null,
            state: "done",
          },
        ],
      },
      // Accepting was a button: the question comes first, then Iris's line.
      {
        role: "Company",
        author: agent,
        text: "Shall we refund it?",
        direct: true,
      },
      {
        role: "Agent",
        text: "In.",
        steps: [
          {
            text: "Direct Conversation · accepting the Company's invitation",
            how: "setup",
            access: null,
            state: "done",
          },
        ],
      },
      // The User's "yes" stays next to the question it answered.
      { role: "You", text: "yes", direct: true },
      {
        role: "Company",
        author: agent,
        text: "Here is the refund.",
        data: '{"refund_cents":3700}',
        note: "Proposed an operation: approve or decline it below.",
        direct: true,
      },
      { role: "You", text: "Thanks" },
      { role: "Agent", text: "You're welcome." },
    ]);
    // No note written for the model reads as a chat turn.
    expect(JSON.stringify(messages)).not.toMatch(/\((Direct|Said|No reply)/);
  });

  it("still opens a conversation stored before, without the notes for the model", () => {
    expect(
      historyToMessages([
        { role: "user", content: "My order never arrived" },
        { role: "assistant", content: "Lantern asks to talk with you." },
        {
          role: "user",
          content: `(Direct conversation with ${company}: accept)`,
        },
        { role: "assistant", content: "You're talking with Lantern directly." },
        {
          role: "user",
          content: `(Said to ${company} directly, without Iris) yes`,
        },
        {
          role: "assistant",
          content:
            "(No reply from Iris: the user was talking with the Company directly.)",
        },
        {
          role: "user",
          content: `(Written to ${company} directly, without Iris; it may not have been sent) (hello)`,
        },
        { role: "assistant", content: "That direct conversation is over." },
      ]),
    ).toEqual([
      { role: "You", text: "My order never arrived" },
      { role: "Agent", text: "Lantern asks to talk with you." },
      { role: "Agent", text: "You're talking with Lantern directly." },
      { role: "You", text: "yes", direct: true },
      { role: "You", text: "(hello)", direct: true },
      { role: "Agent", text: "That direct conversation is over." },
    ]);
    expect(historyToMessages(undefined)).toEqual([]);
  });

  it("leaves out the model's line about an approval that a stored transcript kept", () => {
    // The page showed each outcome on the operation's entry, never as a
    // message under Iris's name.
    expect(
      historyToMessages([
        { role: "user", content: "Refund my order", signedOut: true },
        { role: "assistant", content: "Lantern proposes a refund." },
        {
          role: "assistant",
          content:
            "Company operation succeeded: Refunded USD 37.00 for order ord_LNB0907.",
        },
        {
          role: "assistant",
          content:
            "Company declined the approval; nothing was performed. Lantern Noodle Bar declined this approval and did nothing.",
        },
        {
          role: "assistant",
          content:
            "The Company declined the approval Iris sent on the user's standing instruction; nothing was performed, and it's waiting for the user.",
        },
        { role: "user", content: "Thanks" },
      ]),
    ).toEqual([
      { role: "You", text: "Refund my order" },
      { role: "Agent", text: "Lantern proposes a refund." },
      { role: "You", text: "Thanks" },
    ]);
  });
});
