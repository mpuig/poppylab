import { describe, expect, it } from "vitest";
import type { Message } from "./companies";
import {
  readAnswer,
  withDelta,
  withoutStreamed,
  type AnswerDelta,
} from "./answer-events";

/** A response streaming `events`, cut every few bytes; `end: false` stops before the last. */
function streaming(events: object[], end = true) {
  const text = events
    .map(
      (e) =>
        `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`,
    )
    .join("");
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < bytes.length; at += 11)
          controller.enqueue(bytes.slice(at, at + 11));
        if (end) controller.close();
        else controller.error(new Error("network"));
      },
    }),
    { headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
  );
}
const delta = (text: string, index: number, message = "m1") => ({
  type: "message.delta",
  message,
  index,
  text,
  spoken: text.trim(),
});

describe("reading a chat answer", () => {
  it("gives each sentence as it comes, then the response the stream ends with", async () => {
    const seen: AnswerDelta[] = [];
    const response = await readAnswer(
      streaming([
        delta("Apples are in. ", 0),
        delta("Pears too.", 1),
        {
          type: "answer",
          status: 200,
          headers: { "X-Poppy-Conversation": "run_1" },
          body: { text: "Apples are in. Pears too." },
        },
      ]),
      (d) => seen.push(d),
    );
    expect(seen.map((d) => d.text)).toEqual(["Apples are in. ", "Pears too."]);
    expect(response!.status).toBe(200);
    expect(response!.headers.get("X-Poppy-Conversation")).toBe("run_1");
    expect(await response!.json()).toEqual({
      text: "Apples are in. Pears too.",
    });
  });

  it("keeps the answer's status for a turn that failed after it began", async () => {
    const response = await readAnswer(
      streaming([
        delta("Half. ", 0),
        { type: "answer", status: 502, headers: {}, body: { error: "No." } },
      ]),
      () => {},
    );
    expect(response!.ok).toBe(false);
    expect(await response!.json()).toEqual({ error: "No." });
  });

  it("answers a response that isn't a stream as it is", async () => {
    const whole = Response.json({ text: "Whole." });
    expect(await readAnswer(whole, () => {})).toBe(whole);
  });

  it("answers nothing when the stream stops before its answer", async () => {
    const seen: AnswerDelta[] = [];
    expect(
      await readAnswer(streaming([delta("Half. ", 0)], false), (d) =>
        seen.push(d),
      ),
    ).toBeUndefined();
    expect(
      await readAnswer(streaming([delta("Half. ", 0)]), () => {}),
    ).toBeUndefined();
  });
});

describe("the page's messages as the answer is written", () => {
  const said: Message[] = [{ role: "You", text: "What do you sell?" }];

  it("writes each sentence into the same message, then gives its place to the answer", () => {
    let shown = withDelta(said, delta("Apples are in. ", 0));
    shown = withDelta(shown, delta("Pears too.", 1));
    expect(shown).toEqual([
      ...said,
      { role: "Agent", text: "Apples are in. Pears too.", streaming: "m1" },
    ]);
    expect(withoutStreamed(shown)).toEqual(said);
  });

  it("shows Iris's own line before the answer as its own words", () => {
    const shown = withDelta(said, {
      message: "own-1",
      index: 0,
      text: "Connected to Lantern Noodle Bar.",
      own: true,
    });
    expect(shown.at(-1)).toMatchObject({ role: "Own", streaming: "own-1" });
  });
});
