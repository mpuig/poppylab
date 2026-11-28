/**
 * A turn's answer as it is written, for a client that asked for it with
 * `Accept: text/event-stream`: each of the agent's sentences as a
 * `message.delta` event, with its spoken form, then the turn's result as
 * it is without the stream. A voice client says each sentence as it
 * comes, so the User hears the first while the model writes the rest.
 *
 * Only the agent's own words are streamed. A Company's content keeps its
 * own message (§10.1), which comes whole with the result; a model that
 * quotes it does so in the form the agent's answer always has ("Lantern
 * says: “…”").
 */
import { opaqueId } from "./account-store";
import { sentenceSplitter, sentencesOf } from "./sentences";
import { spokenText } from "./spoken";

/** One sentence of one of the agent's messages, as it is written. */
export type MessageDelta = {
  type: "message.delta";
  /** The message's ID, which the result's message carries as `id`. */
  message: string;
  /** Its place in the message: 0, 1, 2… */
  index: number;
  /** The sentence as written, with the space around it: joined, the text. */
  text: string;
  /** The sentence to say aloud (`spokenText`); empty when it holds nothing to say. */
  spoken: string;
};

/**
 * Where a turn's words go while it runs: the model's answer piece by
 * piece, and a line of the agent's own said before it (Iris connected a
 * Company for the request, say).
 */
export type TurnStream = {
  text(piece: string): void;
  line(text: string): void;
};

type Said = {
  id: string;
  text: string;
  index: number;
  split: ReturnType<typeof sentenceSplitter>;
};

/**
 * The agent's messages of one turn, each sent as its sentences. `stream`
 * is for the turn to write to; `finish` takes the turn's result and gives
 * each of the agent's messages in it the ID its sentences went under,
 * sending whole, in their place, those the turn didn't stream: demo
 * mode's answers and the agent's own lines, which are there at once.
 */
export function answerStream(send: (delta: MessageDelta) => void) {
  const said: Said[] = [];
  let open: Said | undefined;
  const begin = (text = "") => {
    const message: Said = {
      id: opaqueId(),
      text,
      index: 0,
      split: sentenceSplitter(),
    };
    said.push(message);
    return message;
  };
  const say = (message: Said, pieces: string[]) => {
    for (const text of pieces)
      if (text.trim())
        send({
          type: "message.delta",
          message: message.id,
          index: message.index++,
          text,
          spoken: spokenText(text),
        });
  };
  const close = () => {
    if (open) say(open, open.split.end());
    open = undefined;
  };
  const stream: TurnStream = {
    text(piece) {
      open ??= begin();
      open.text += piece;
      say(open, open.split.push(piece));
    },
    line(text) {
      close();
      say(begin(text), sentencesOf(text));
    },
  };
  return {
    stream,
    /** Whether a sentence has been sent. */
    get started() {
      return said.some((message) => message.index > 0);
    },
    finish<M extends { from: string; text: string }>(
      messages: M[],
    ): Array<M & { id?: string }> {
      if (
        open &&
        messages.some(
          (message) =>
            message.from === "agent" && same(open!.text, message.text),
        )
      )
        close();
      else open = undefined;
      const left = said.slice();
      return messages.map((message) => {
        if (message.from !== "agent" || !message.text.trim()) return message;
        const at = left.findIndex(
          (s) => s.index > 0 && same(s.text, message.text),
        );
        if (at >= 0) return { ...message, id: left.splice(at, 1)[0]!.id };
        const whole = begin(message.text);
        say(whole, sentencesOf(message.text));
        return whole.index > 0 ? { ...message, id: whole.id } : message;
      });
    },
  };
}

/** A streamed message and the one kept, which may have been cut short. */
const same = (streamed: string, kept: string) => {
  const a = streamed.trim();
  const b = kept.trim();
  if (!a || !b) return false;
  return (
    a === b || (b.length > 1 && b.endsWith("…") && a.startsWith(b.slice(0, -1)))
  );
};

/** Whether a request asked for its answer as it is written. */
export const wantsEvents = (request: Request) =>
  /\btext\/event-stream\b/.test(request.headers.get("accept") ?? "");

type Event = { type: string };

/**
 * A turn's events as Server-Sent Events. `run` sends them as the turn
 * goes and answers the last one, or, when it sent none, the response to
 * answer in place of a stream (`instead`). The response waits for the
 * first event, so a turn refused before it said anything is answered
 * with its own status and body, as it would be without the stream. The
 * turn goes on to its end if the client goes away: it holds the
 * conversation, and its answer is kept for a reload.
 */
export async function turnEvents(
  run: (
    send: (event: Event) => void,
  ) => Promise<{ last: Event; instead?: (() => Response) | undefined }>,
): Promise<Response> {
  const queued: Event[] = [];
  let write: ((event: Event) => void) | undefined;
  let begin!: () => void;
  const begun = new Promise<undefined>((resolve) => {
    begin = () => resolve(undefined);
  });
  const send = (event: Event) => {
    if (write) write(event);
    else queued.push(event);
    begin();
  };
  const ended = run(send);
  const first = await Promise.race([begun, ended]);
  if (first?.instead && !queued.length) return first.instead();
  const encoder = new TextEncoder();
  let gone = false;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const put = (event: Event) => {
        if (gone) return;
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            ),
          );
        } catch {
          gone = true;
        }
      };
      for (const event of queued.splice(0)) put(event);
      write = put;
      try {
        put((await ended).last);
      } catch {
        put({
          type: "error",
          status: 500,
          error: "The answer stopped. Read the conversation again to see it.",
        } as Event);
      }
      try {
        controller.close();
      } catch {
        // The client went away.
      }
    },
    cancel() {
      gone = true;
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
