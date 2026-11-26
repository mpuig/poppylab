import type { Run } from "./runtime";

/** A task the Company doesn't offer (§9.1), as the Inspector lists it. */
export type ShownTask = { task: string; alternative?: string };

/**
 * §9.1: the excluded tasks the run's current Session read, for the
 * Inspector's "Tasks not offered": each task and the words of its
 * alternative, cut short. Company content, shown as plain text. None before
 * a Session has read them: the tasks of an earlier Session aren't this one's
 * (§9), and an ended conversation keeps none.
 */
export function shownTasks(run: Pick<Run, "tasks" | "sessionId">): ShownTask[] {
  if (!run.tasks || run.tasks.sid !== run.sessionId) return [];
  return run.tasks.value.excludedTasks.map(({ task, alternative }) => {
    const words = alternative?.instructions;
    return {
      task,
      ...(words
        ? {
            alternative: words.length > 300 ? `${words.slice(0, 299)}…` : words,
          }
        : {}),
    };
  });
}
