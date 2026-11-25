import type { DirectAction } from "./conversations";
import type { Run } from "./runtime";

/**
 * Adds turns to the model's context (`history`, which callers cut to the
 * last ten) and to the transcript the page shows, which keeps the whole
 * conversation up to a bound.
 */
export function record(run: Run, ...turns: Run["history"]) {
  show(run, ...turns);
  run.history.push(...turns);
}

/** Adds turns to the transcript the page shows, and not to the model's. */
function show(run: Run, ...turns: Run["history"]) {
  run.transcript = [...(run.transcript ?? run.history), ...turns].slice(-80);
}

/**
 * §8.10: one of the User's own actions on a Direct Conversation. The page
 * tells them Iris doesn't read what they type there, so their words stay in
 * the transcript, for the page to show again after a reload, and never go
 * to the model. The model gets Iris's own line and that the User wrote to
 * the Company; when Iris said nothing, it gets nothing.
 */
export function recordDirect(
  run: Run,
  company: string,
  action: DirectAction,
  words: string,
  said: string,
) {
  const spoke = action === "say" || action === "start";
  const did = `(Direct conversation with ${company}: ${action})`;
  const reply = {
    role: "assistant" as const,
    content:
      said ||
      "(No reply from Iris: the user was talking with the Company directly.)",
  };
  show(
    run,
    {
      role: "user",
      content: spoke
        ? `(Said to ${company} directly, without Iris) ${words}`
        : did,
    },
    reply,
  );
  if (said)
    run.history.push(
      {
        role: "user",
        content: spoke
          ? `(The user wrote to ${company} directly, without Iris.)`
          : did,
      },
      reply,
    );
}
