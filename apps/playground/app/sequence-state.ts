/**
 * The home's sequence figure is either waiting for the visitor's approval or
 * approved, and has been drawn some number of times from its first message.
 * These are the steps between those states, kept apart from the component so
 * a test can hold them.
 */
export type SequenceState = { signed: boolean; run: number };

export const initialSequence: SequenceState = { signed: false, run: 0 };

/** "Approve": the last two messages are drawn. The first four stay as they are. */
export const approveSequence = (state: SequenceState): SequenceState => ({
  ...state,
  signed: true,
});

/** "Show it again": back to waiting, as a new run. */
export const replaySequence = (state: SequenceState): SequenceState => ({
  signed: false,
  run: state.run + 1,
});

/**
 * The key of one of messages 1 to 4. A CSS animation plays when its element is
 * mounted, and these messages stay mounted when the figure is reset, so the
 * run is part of the key: a new run mounts them again and they are drawn from
 * the first message.
 */
export const firstMessageKey = (run: number, text: string) => `${run}-${text}`;
