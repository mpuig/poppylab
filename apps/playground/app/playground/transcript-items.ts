/**
 * Where everything that waits for the person goes in the transcript: at
 * the point it arose, in time order, and nowhere else. A proposal's card
 * follows the message it arrived with (`Message.proposals`, which the
 * server keeps with the conversation); an ask of the page's own (a sign-in
 * to finish or do again, the change permission to ask for) follows the
 * message that was last when it arose. Once decided or no longer needed,
 * it stays where it was, folded to how it ended, and never moves below a
 * later message. Plain data, so the order can be tested without a page.
 */
import type { Message } from "./companies";

/** A proposal at one Company, as the transcript places it. */
export type Placed = { key: string };

/**
 * The page's memory of where things arose that no message names: by key,
 * the index of the message that was last when the page first saw it (-1
 * before any message). A proposal a card's button replaced with new terms
 * comes without a message, as does a sign-in the bar started.
 */
export type Arrivals = Map<string, number>;

/** A proposal's key: two Companies may use the same IDs. */
export const proposalKey = (origin: string, operationId: string) =>
  `${origin} ${operationId}`;

/** The element ID of a proposal's card, for the inbox to bring it into view. */
export const cardId = (key: string) =>
  `proposal-${key.replace(/^https?:\/\//, "").replace(/[^A-Za-z0-9_-]+/g, "-")}`;

/**
 * The index of the message each proposal arrived with: the last message
 * that names it (new terms for the same proposal arrive again, later).
 */
export function namedAt(messages: readonly Message[]) {
  const at = new Map<string, number>();
  messages.forEach((message, index) => {
    for (const ref of message.proposals ?? [])
      at.set(proposalKey(ref.company, ref.proposal), index);
  });
  return at;
}

/** One row of the transcript: a message, or what follows one. */
export type Row<T> =
  { kind: "message"; index: number } | { kind: "item"; item: T; key: string };

/**
 * The transcript in order: each message, then what arose after it. A
 * thing no message names is placed where the page first saw it, which
 * `arrivals` remembers from then on (it is updated here). Things that
 * arose at the same point keep the order they are given in.
 */
export function placeRows<T extends Placed>(
  messages: readonly Message[],
  items: readonly T[],
  arrivals: Arrivals,
): Row<T>[] {
  const named = namedAt(messages);
  const last = messages.length - 1;
  const after = new Map<number, T[]>();
  for (const item of items) {
    let at = named.get(item.key);
    if (at === undefined) {
      if (!arrivals.has(item.key)) arrivals.set(item.key, last);
      // What the page showed may have been taken back since (a sign-in
      // resets it): never past the end.
      at = Math.min(arrivals.get(item.key)!, last);
    }
    const list = after.get(at) ?? [];
    list.push(item);
    after.set(at, list);
  }
  const rows: Row<T>[] = [];
  const add = (at: number) => {
    for (const item of after.get(at) ?? [])
      rows.push({ kind: "item", item, key: item.key });
  };
  add(-1);
  messages.forEach((_, index) => {
    rows.push({ kind: "message", index });
    add(index);
  });
  return rows;
}
