/**
 * How large a stored conversation may be. A run is sealed into one stored
 * value with every Company's part in it (`runs.ts`, `sealed.ts`). On
 * Workers that value is a Durable Object row of at most 2 MB, and sealing
 * writes the ciphertext as base64, a third longer than the JSON it holds.
 *
 * The parts that grow with the conversation have bounds of their own (the
 * transcript, the Inspector's lines, each Company's proposals and offered
 * tools). What a Company publishes has only the bounds of one document
 * (512 KB each for its discovery and its metadata), so three large
 * Companies could pass the row's size. These two bounds are for that.
 */
export const RUN_LIMITS = {
  /**
   * UTF-8 bytes of the run as JSON above which it isn't stored: sealed,
   * that is under 1.9 MB. The request is told (`RunNotSaved`).
   */
  bytes: 1_400_000,
  /**
   * The same, above which the conversation takes no further Company. The
   * half megabyte between the two is for what it goes on to keep: the
   * whole transcript and every line of the Inspector come to 336 KB.
   */
  connect: 900_000,
} as const;

const encoder = new TextEncoder();

/** UTF-8 bytes of a value as JSON, which is how it is stored. */
export const bytesOf = (value: unknown) =>
  encoder.encode(JSON.stringify(value) ?? "").length;

/**
 * A conversation that couldn't be stored: `too_large` when it is over the
 * bound, `failed` when the store refused it. What the request did is not
 * kept, and the conversation is left unlocked as it was last stored.
 */
export class RunNotSaved extends Error {
  constructor(public reason: "too_large" | "failed") {
    super(`Conversation not saved (${reason})`);
    this.name = "RunNotSaved";
  }
}

/** What a request is answered when its conversation couldn't be stored. */
export const notSaved = (error: unknown) =>
  error instanceof RunNotSaved && error.reason === "too_large"
    ? {
        status: 507,
        code: "conversation_too_large",
        error:
          "This conversation has grown too large to keep, so what this request did wasn't saved and a reload won't show it. Start a new conversation to go on.",
      }
    : {
        status: 503,
        code: "conversation_not_saved",
        error:
          "This conversation couldn't be saved just now, so what this request did wasn't kept and a reload won't show it. Try again in a moment.",
      };
