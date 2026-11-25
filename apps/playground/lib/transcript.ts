import type { Run } from "./runtime";

/**
 * Adds turns to the model's context (`history`, which callers cut to the
 * last ten) and to the transcript the page shows, which keeps the whole
 * conversation up to a bound.
 */
export function record(run: Run, ...turns: Run["history"]) {
  run.transcript = [...(run.transcript ?? run.history), ...turns].slice(-80);
  run.history.push(...turns);
}
