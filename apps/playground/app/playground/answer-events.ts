/**
 * A chat answer that comes as it is written: the chat route streams the
 * model's sentences (`message.delta`) and ends with `answer`, the
 * response the request would have had without the stream. Plain data, so
 * the page's reading of it can be checked without a page.
 */
import type { Message } from "./companies";

/** One sentence of the answer, as the route sends it. */
export type AnswerDelta = {
  message: string;
  index: number;
  text: string;
  /** Iris's own line from before the answer, which comes whole. */
  own?: boolean;
};

/**
 * The response to a chat request, read to its end. A stream gives each
 * sentence to `onDelta` as it comes and answers the response its last
 * event holds; an answer that isn't a stream is answered as it is.
 * `undefined` when the stream stopped before its answer.
 */
export async function readAnswer(
  response: Response,
  onDelta: (delta: AnswerDelta) => void,
): Promise<Response | undefined> {
  if (
    !/text\/event-stream/.test(response.headers.get("content-type") ?? "") ||
    !response.body
  )
    return response;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let answer: Response | undefined;
  const take = (block: string) => {
    let type = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) type = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) return;
    const event = JSON.parse(data) as {
      status?: number;
      headers?: Record<string, string>;
      body?: unknown;
    } & AnswerDelta;
    if (type === "message.delta") onDelta(event);
    else if (type === "answer")
      answer = new Response(JSON.stringify(event.body ?? {}), {
        status: event.status ?? 200,
        headers: { ...event.headers, "Content-Type": "application/json" },
      });
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffered += decoder.decode(value, { stream: !done });
      const blocks = buffered.split("\n\n");
      buffered = blocks.pop() ?? "";
      for (const block of blocks) take(block);
      if (done) break;
    }
    if (buffered.trim()) take(buffered);
  } catch {
    return answer;
  }
  return answer;
}

/**
 * The page's messages with one more sentence of a streamed answer: in
 * the message it is writing, or in a new one after the rest.
 */
export function withDelta(messages: Message[], delta: AnswerDelta): Message[] {
  const at = messages.findIndex((m) => m.streaming === delta.message);
  if (at < 0)
    return [
      ...messages,
      {
        role: delta.own ? "Own" : "Agent",
        text: delta.text.trimStart(),
        streaming: delta.message,
      },
    ];
  const next = messages.slice();
  next[at] = { ...next[at]!, text: next[at]!.text + delta.text };
  return next;
}

/** The page's messages without what was streamed: the answer takes its place. */
export const withoutStreamed = (messages: Message[]) =>
  messages.filter((m) => !m.streaming);
