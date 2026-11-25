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
 *
 * `sent` says their words reached the Company. Iris's line is sometimes
 * that they didn't (the thread had closed, sign-in was needed), and then
 * neither the model nor the page is told they were said.
 */
export function recordDirect(
  run: Run,
  company: string,
  action: DirectAction,
  words: string,
  said: string,
  sent: boolean,
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
      content: !spoke
        ? did
        : sent
          ? `(Said to ${company} directly, without Iris) ${words}`
          : `(Written to ${company} directly, without Iris; it may not have been sent) ${words}`,
    },
    reply,
  );
  if (said)
    run.history.push(
      {
        role: "user",
        content: !spoke
          ? did
          : sent
            ? `(The user wrote to ${company} directly, without Iris.)`
            : `(The user tried to write to ${company} directly, without Iris; it may not have been sent.)`,
      },
      reply,
    );
}
