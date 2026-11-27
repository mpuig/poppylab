/**
 * An answer cut into sentences as it is written, for a client that shows
 * or says each one as it comes: a voice client starts speaking at the
 * first. A sentence ends at a stop followed by a space, at a line's end,
 * or, in a sentence too long to say in one breath, at the last comma or
 * space before `LONGEST`; never inside a word. A code block is one piece.
 * The pieces, joined, are the text as it was written, spaces and all.
 *
 * Plain data and no I/O.
 */

/** A sentence longer than this is cut at a clause or a space. */
export const LONGEST = 220;

/** Words whose stop ends no sentence. */
const ABBREVIATIONS =
  /(?:^|[\s(])(?:e\.g|i\.e|vs|approx|incl|Mr|Mrs|Ms|Dr|St)\.$/;
/** A stop, its closing quotes or brackets, and the space after them. */
const STOP = /[.!?…]+["'”’)\]]*(?=\s)/g;

/** Where the first sentence of `text` ends, or -1 when it may go on. */
function end(text: string): number {
  // Leading space belongs to the sentence after it.
  const start = text.length - text.trimStart().length;
  if (text.startsWith("```", start)) {
    // A code block, to the end of the line that closes it.
    const close = text.indexOf("```", start + 3);
    if (close < 0) return -1;
    const line = text.indexOf("\n", close);
    return line < 0 ? -1 : line + 1;
  }
  const line = text.indexOf("\n", start);
  STOP.lastIndex = start;
  for (let stop = STOP.exec(text); stop; stop = STOP.exec(text)) {
    const at = stop.index + stop[0].length;
    if (line >= 0 && line < at) break;
    const before = text.slice(start, at);
    // "1." starts a list, and "e.g." goes on.
    if (/^\s*\d+[.)]$/.test(before) || ABBREVIATIONS.test(before)) continue;
    return spaced(text, at);
  }
  if (line >= 0) return spaced(text, line);
  if (text.length - start <= LONGEST) return -1;
  // Too long to say at once: at the last clause, or else the last space.
  const head = text.slice(0, start + LONGEST);
  const clause = Math.max(
    ...[", ", "; ", ": "].map((mark) => head.lastIndexOf(mark) + 1),
    head.lastIndexOf(" — ") + 2,
  );
  if (clause > start + LONGEST / 3) return spaced(text, clause);
  const space = head.lastIndexOf(" ");
  return space > start ? spaced(text, space) : -1;
}

/** `at`, past the spaces and line ends after it. */
function spaced(text: string, at: number) {
  while (at < text.length && /\s/.test(text[at]!)) at++;
  return at;
}

/**
 * A splitter for text that arrives in pieces: `push` answers the
 * sentences each piece completed, `end` the rest once the text is all
 * there. A sentence is answered only once what follows it shows that it
 * ended: a space after its stop, so "12." of "12.50" never ends one.
 */
export function sentenceSplitter() {
  let pending = "";
  const take = (final: boolean) => {
    const done: string[] = [];
    for (;;) {
      const at = end(pending);
      if (at < 0) break;
      done.push(pending.slice(0, at));
      pending = pending.slice(at);
    }
    if (final && pending.trim()) done.push(pending);
    if (final) pending = "";
    return done;
  };
  return {
    push(text: string) {
      pending += text;
      return take(false);
    },
    end() {
      return take(true);
    },
  };
}

/** A whole text's sentences, as a splitter answers them. */
export function sentencesOf(text: string) {
  const splitter = sentenceSplitter();
  return [...splitter.push(text), ...splitter.end()];
}
