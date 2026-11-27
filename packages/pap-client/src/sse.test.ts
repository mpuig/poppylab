/**
 * §8.6: the event-stream parser, and the conversation stream reader against
 * a server that writes the stream in awkward pieces.
 */
import { createServer, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it } from "vitest";
import {
  ProtocolError,
  sseParser,
  streamConversationEvents,
  type ConversationStreamItem,
} from "./index.ts";

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
async function endpoint(
  handler: (headers: Record<string, unknown>, res: ServerResponse) => void,
) {
  const server = createServer((req, res) => handler(req.headers, res));
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("address");
  return `http://127.0.0.1:${address.port}`;
}

it("parses events split anywhere, with CR, LF or CRLF line ends", () => {
  const text =
    ': hello\r\nid: evt_1\r\ndata: {"a":\r\ndata: 1}\r\n\r\nevent: working\rdata: {}\r\rdata\n\nid: x\0y\ndata: z\n\n';
  const whole = sseParser().push(text);
  const parser = sseParser();
  const pieces = [...text].flatMap((ch) => parser.push(ch));
  expect(pieces).toEqual(whole);
  expect(whole).toEqual([
    { event: "message", data: '{"a":\n1}', id: "evt_1", lastEventId: "evt_1" },
    { event: "working", data: "{}", id: undefined, lastEventId: "evt_1" },
    { event: "message", data: "", id: undefined, lastEventId: "evt_1" },
    // An ID with a NUL is ignored.
    { event: "message", data: "z", id: undefined, lastEventId: "evt_1" },
  ]);
  expect(() => sseParser(10).push(`data: ${"x".repeat(20)}`)).toThrow(
    "Stream event is too large",
  );
});

it("reads a conversation stream: events, working and pieces of text, skipping what it doesn't know", async () => {
  let asked: Record<string, unknown> = {};
  const url = await endpoint((headers, res) => {
    asked = headers;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const frames = [
      'event: working\ndata: {"working":true}\n\n',
      'event: text-delta\ndata: {"message_id":"msg_1","text":"Hel"}\n\n',
      "event: future\ndata: {}\n\n",
      "id: evt_bad\ndata: not json\n\n",
      // The SSE ID must be the event's own.
      'id: evt_9\ndata: {"id":"evt_8","type":"message"}\n\n',
      'id: evt_2\ndata: {"id":"evt_2","type":"message","message":{"text":"Hello"}}\n\n',
      'event: working\ndata: {"working":false}\n\n',
    ].join("");
    // Written a few bytes at a time.
    let at = 0;
    const next = () => {
      if (at >= frames.length) return res.end();
      res.write(frames.slice(at, (at += 7)));
      setImmediate(next);
    };
    next();
  });
  const items: ConversationStreamItem[] = [];
  const result = await streamConversationEvents(
    `${url}/c/events?cursor=evt_0`,
    { headers: { "poppy-version": "1.0" } },
    (item) => {
      items.push(item);
    },
    { allowedPrivateOrigins: [url], lastEventId: "evt_1" },
  );
  expect(asked).toMatchObject({
    accept: "text/event-stream",
    "last-event-id": "evt_1",
    "poppy-version": "1.0",
  });
  expect(items).toEqual([
    { type: "working", working: true },
    { type: "text-delta", message_id: "msg_1", text: "Hel" },
    {
      type: "event",
      event: { id: "evt_2", type: "message", message: { text: "Hello" } },
    },
    { type: "working", working: false },
  ]);
  expect(result).toEqual({
    streamed: true,
    lastEventId: "evt_2",
    ended: "closed",
  });
});

it("stops when asked, times out, and returns JSON or the error of a Company that answers that way", async () => {
  const open = await endpoint((_headers, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write('id: evt_1\ndata: {"id":"evt_1","type":"state"}\n\n');
  });
  expect(
    await streamConversationEvents(`${open}/e`, {}, () => false, {
      allowedPrivateOrigins: [open],
    }),
  ).toEqual({ streamed: true, lastEventId: "evt_1", ended: "stopped" });
  expect(
    await streamConversationEvents(`${open}/e`, {}, () => {}, {
      allowedPrivateOrigins: [open],
      timeoutMs: 300,
    }),
  ).toEqual({ streamed: true, lastEventId: "evt_1", ended: "timeout" });

  // A streamed:true body is JSON like any other.
  const json = await endpoint((_headers, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"events":[],"streamed":true}');
  });
  expect(
    await streamConversationEvents(`${json}/e`, {}, () => {}, {
      allowedPrivateOrigins: [json],
    }),
  ).toEqual({ streamed: false, read: { events: [], streamed: true } });

  const refused = await endpoint((_headers, res) => {
    res.writeHead(410, { "Content-Type": "application/json" });
    res.end('{"error":"cursor_expired"}');
  });
  const error = await streamConversationEvents(`${refused}/e`, {}, () => {}, {
    allowedPrivateOrigins: [refused],
  }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ProtocolError);
  expect(error).toMatchObject({ status: 410, code: "cursor_expired" });
});
