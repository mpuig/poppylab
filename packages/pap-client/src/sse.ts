/**
 * Server-sent events, parsed as the HTML standard's event stream
 * interpretation does (WHATWG HTML §9.2.6), from text that arrives in
 * pieces: a line may end with CR, LF or CRLF, even split across pieces.
 */
export type SseEvent = {
  /** The `event` field, or `message` without one. */
  event: string;
  data: string;
  /** The `id` field of this event, if it had one. */
  id: string | undefined;
  /** The last event ID so far, which an `id` field in any event sets. */
  lastEventId: string;
};

/**
 * A parser that keeps what an incomplete event has so far. `maxEvent`
 * bounds the characters one event (or one line) may hold.
 */
export function sseParser(maxEvent = 262144) {
  let pending = "",
    data: string[] = [],
    event = "",
    id: string | undefined,
    lastEventId = "",
    held = 0;
  const line = (text: string, out: SseEvent[]) => {
    if (text === "") {
      // A blank line dispatches the event, if it has data.
      if (data.length)
        out.push({
          event: event || "message",
          data: data.join("\n"),
          id,
          lastEventId,
        });
      data = [];
      event = "";
      id = undefined;
      held = 0;
      return;
    }
    if (text.startsWith(":")) return;
    const colon = text.indexOf(":");
    const name = colon < 0 ? text : text.slice(0, colon);
    let value = colon < 0 ? "" : text.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    held += value.length;
    if (held > maxEvent) throw new Error("Stream event is too large");
    if (name === "data") data.push(value);
    else if (name === "event") event = value;
    else if (name === "id" && !value.includes("\0")) lastEventId = id = value;
  };
  return {
    /** The events completed by this piece of text. */
    push(text: string): SseEvent[] {
      const out: SseEvent[] = [];
      pending += text;
      let start = 0;
      for (let i = 0; i < pending.length; i++) {
        const ch = pending[i];
        if (ch !== "\n" && ch !== "\r") continue;
        // A CR at the end may be the first half of a CRLF: wait for more.
        if (ch === "\r" && i === pending.length - 1) break;
        line(pending.slice(start, i), out);
        if (ch === "\r" && pending[i + 1] === "\n") i++;
        start = i + 1;
      }
      pending = pending.slice(start);
      if (pending.length > maxEvent)
        throw new Error("Stream event is too large");
      return out;
    },
  };
}
