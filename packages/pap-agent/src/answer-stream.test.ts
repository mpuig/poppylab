import { describe, expect, it } from "vitest";
import {
  answerStream,
  turnEvents,
  wantsEvents,
  type MessageDelta,
} from "./answer-stream";

/** The events of a streamed response, in order. */
async function eventsOf(response: Response) {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const [event, data] = block.split("\n");
      const parsed = JSON.parse(data!.slice("data: ".length)) as {
        type: string;
      };
      expect(event).toBe(`event: ${parsed.type}`);
      return parsed;
    });
}

describe("a turn's answer as it is written", () => {
  it("sends the model's sentences as they end, each with its spoken form", () => {
    const sent: MessageDelta[] = [];
    const said = answerStream((delta) => sent.push(delta));
    said.stream.text("Your total is $88");
    expect(sent).toEqual([]);
    said.stream.text(".00. It was ");
    expect(sent).toEqual([
      {
        type: "message.delta",
        message: sent[0]!.message,
        index: 0,
        text: "Your total is $88.00. ",
        spoken: "Your total is 88 dollars.",
      },
    ]);
    said.stream.text("`ord_LNB1001`, 15 more.");
    const [message] = said
      .finish([
        { from: "user", text: "What is my total?" },
        {
          from: "agent",
          text: "Your total is $88.00. It was `ord_LNB1001`, 15 more.",
        },
      ])
      .slice(1);
    expect(sent.map((d) => [d.index, d.text, d.spoken])).toEqual([
      [0, "Your total is $88.00. ", "Your total is 88 dollars."],
      [1, "It was `ord_LNB1001`, 15 more.", "It was, 15 more."],
    ]);
    // The result's message names the sentences it was sent as.
    expect(message!.id).toBe(sent[0]!.message);
    expect(new Set(sent.map((d) => d.message)).size).toBe(1);
  });

  it("sends whole what the turn said at once, in the result's order, and never a Company's words", () => {
    const sent: MessageDelta[] = [];
    const said = answerStream((delta) => sent.push(delta));
    said.stream.line("Connected to Lantern Noodle Bar.");
    said.stream.text("The menu has noodles. And dumplings.");
    const messages = said.finish([
      { from: "user", text: "connect Lantern and show the menu" },
      { from: "agent", text: "Connected to Lantern Noodle Bar." },
      { from: "company", text: "Today only: free tea." },
      { from: "agent", text: "The menu has noodles. And dumplings." },
      {
        from: "agent",
        text: "Lantern wants to change your order. Approve it?",
      },
    ]);
    expect(sent.map((d) => d.text)).toEqual([
      "Connected to Lantern Noodle Bar.",
      "The menu has noodles. ",
      "And dumplings.",
      "Lantern wants to change your order. ",
      "Approve it?",
    ]);
    expect(sent.some((d) => d.text.includes("free tea"))).toBe(false);
    expect(messages.map((m) => "id" in m)).toEqual([
      false,
      true,
      false,
      true,
      true,
    ]);
    const ids = messages.flatMap((m) => ("id" in m ? [m.id] : []));
    expect(new Set(ids).size).toBe(3);
    expect(sent.map((d) => ids.indexOf(d.message))).toEqual([0, 1, 1, 2, 2]);
  });

  it("gives no ID to a streamed answer the result doesn't hold", () => {
    const sent: MessageDelta[] = [];
    const said = answerStream((delta) => sent.push(delta));
    said.stream.text("Half an answer. ");
    const messages = said.finish([
      { from: "user", text: "hello" },
      { from: "agent", text: "The model couldn't answer just now." },
    ]);
    expect(messages[1]!.id).not.toBe(sent[0]!.message);
  });

  it("drops an unflushed streamed fragment when the turn result does not keep it", () => {
    const sent: MessageDelta[] = [];
    const said = answerStream((delta) => sent.push(delta));
    said.stream.text("Private balance $5000");
    expect(sent).toEqual([]);
    const messages = said.finish([]);
    expect(messages).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("never misassociates IDs on blank text, bare ellipsis, or repeated agent lines", () => {
    const sent: MessageDelta[] = [];
    const said = answerStream((delta) => sent.push(delta));
    said.stream.line("Done.");
    said.stream.text("Working on it");
    const messages = said.finish([
      { from: "agent", text: "   " },
      { from: "agent", text: "…" },
      { from: "agent", text: "Done." },
      { from: "agent", text: "Done." },
      { from: "agent", text: "Working on it" },
    ]);
    expect("id" in messages[0]!).toBe(false);
    const ids = messages.slice(1).map((m) => m.id);
    expect(ids.every((id) => typeof id === "string")).toBe(true);
    expect(new Set(ids).size).toBe(4);
    expect(messages[2]!.id).toBe(sent[0]!.message);
    expect(messages[3]!.id).not.toBe(messages[2]!.id);
    expect(messages[1]!.id).not.toBe(messages[4]!.id);
    expect(sent.filter((d) => d.message === messages[4]!.id)).toEqual([
      {
        type: "message.delta",
        message: messages[4]!.id,
        index: 0,
        text: "Working on it",
        spoken: "Working on it.",
      },
    ]);
  });

  it("streams only current-turn agent messages when a turn has no user line", () => {
    const sent: MessageDelta[] = [];
    const said = answerStream((delta) => sent.push(delta));
    const messages = said.finish([
      { from: "company", text: "Hi, I'm Maya at Lantern." },
      {
        from: "agent",
        text: "You're talking directly with Lantern Noodle Bar now.",
      },
    ]);
    expect("id" in messages[0]!).toBe(false);
    expect(messages[1]!.id).toBe(sent[0]!.message);
    expect(sent.map((d) => d.text)).toEqual([
      "You're talking directly with Lantern Noodle Bar now.",
    ]);
  });

  it("is asked for with Accept", () => {
    const asking = (accept?: string) =>
      wantsEvents(
        new Request("http://localhost/", {
          headers: accept ? { accept } : {},
        }),
      );
    expect(asking("text/event-stream")).toBe(true);
    expect(asking("text/event-stream, application/json")).toBe(true);
    expect(asking("application/json")).toBe(false);
    expect(asking()).toBe(false);
  });
});

describe("the turn's events", () => {
  it("answers in place of a stream a turn that said nothing", async () => {
    const response = await turnEvents(async () => ({
      last: { type: "error" },
      instead: () => Response.json({ error: "Busy." }, { status: 409 }),
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Busy." });
  });

  it("streams once the turn sends its first event, and ends with the last", async () => {
    let release!: () => void;
    const later = new Promise<void>((resolve) => (release = resolve));
    const response = await turnEvents(async (send) => {
      send({ type: "message.delta" });
      await later;
      send({ type: "message.delta" });
      return { last: { type: "turn" }, instead: () => new Response() };
    });
    // The response is there before the turn ends.
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    release();
    expect((await eventsOf(response)).map((e) => e.type)).toEqual([
      "message.delta",
      "message.delta",
      "turn",
    ]);
  });

  it("streams a turn's result that has no `instead`, and ends with `error` when the turn fails after it began", async () => {
    const quiet = await turnEvents(async () => ({ last: { type: "turn" } }));
    expect((await eventsOf(quiet)).map((e) => e.type)).toEqual(["turn"]);
    const failing = await turnEvents(async (send) => {
      send({ type: "message.delta" });
      throw new Error("internal detail");
    });
    const events = await eventsOf(failing);
    expect(events.map((e) => e.type)).toEqual(["message.delta", "error"]);
    expect(JSON.stringify(events)).not.toContain("internal detail");
  });
});
