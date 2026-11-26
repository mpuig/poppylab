import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SequenceFigure } from "./sequence-figure";
import {
  approveSequence,
  firstMessageKey,
  initialSequence,
  replaySequence,
} from "./sequence-state";

// These tests hold the rule that "Show it again" draws the sequence from its
// first message. A CSS animation plays when its element is mounted, and React
// mounts an element again only when its key changes, so the rule is that the
// keys of messages 1 to 4 change on a replay and on nothing else. Whether the
// browser then plays the animation is not tested here: the repository's tests
// run in node, with no DOM.
const messages = ["one", "two", "three", "four"];
const keys = (run: number) =>
  messages.map((text) => firstMessageKey(run, text));

describe("the home's sequence figure", () => {
  it("starts waiting for approval, in its first run", () => {
    expect(initialSequence).toEqual({ signed: false, run: 0 });
  });

  it("does not draw messages 1 to 4 again when the visitor approves", () => {
    const approved = approveSequence(initialSequence);
    expect(approved.signed).toBe(true);
    expect(keys(approved.run)).toEqual(keys(initialSequence.run));
  });

  it("draws messages 1 to 4 again when the visitor asks to see it again", () => {
    const again = replaySequence(approveSequence(initialSequence));
    expect(again.signed).toBe(false);
    const before = keys(initialSequence.run);
    for (const key of keys(again.run)) expect(before).not.toContain(key);
  });

  it("gives each run its own keys, however many times it is replayed", () => {
    let state = initialSequence;
    const seen = new Set(keys(state.run));
    for (let i = 0; i < 5; i++) {
      state = replaySequence(approveSequence(state));
      for (const key of keys(state.run)) {
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
    expect(seen.size).toBe(messages.length * 6);
  });

  it("opens waiting for approval, with messages 1 to 4 drawn and 6 and 7 held back", () => {
    const html = renderToStaticMarkup(createElement(SequenceFigure));
    expect(html).toContain("Waiting for your approval");
    expect(html).toContain(">Approve<");
    expect(html).not.toContain("Show it again");
    expect(html.match(/class="msg live/g)).toHaveLength(4);
    expect(html.match(/class="msg pending/g)).toHaveLength(2);
  });
});
