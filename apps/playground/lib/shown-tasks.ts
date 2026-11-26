import type { Connection } from "./runtime";

/** A task the Company doesn't offer (§9.1), as the Inspector lists it. */
export type ShownTask = { task: string; alternative?: string };
/** A skill the Company publishes (§9.4), as the Inspector lists it. */
export type ShownSkill = {
  name: string;
  description: string;
  /** The skill's file: an HTTPS URL, checked when the tasks were read. */
  url: string;
  /** The host that serves it, shown since it may not be the Company's. */
  host: string;
};

const short = (words: string) =>
  words.length > 300 ? `${words.slice(0, 299)}…` : words;

/**
 * §9.1: the excluded tasks the connection's current Session read, for the
 * Inspector's "Tasks not offered": each task and the words of its
 * alternative, cut short. Company content, shown as plain text. None before
 * a Session has read them: the tasks of an earlier Session aren't this one's
 * (§9), and an ended conversation keeps none.
 */
export function shownTasks(
  connection: Pick<Connection, "tasks" | "sessionId">,
): ShownTask[] {
  if (!connection.tasks || connection.tasks.sid !== connection.sessionId)
    return [];
  return connection.tasks.value.excludedTasks.map(({ task, alternative }) => {
    const words = alternative?.instructions;
    return { task, ...(words ? { alternative: short(words) } : {}) };
  });
}

/**
 * §9.4: the skills the connection's current Session read, for the Inspector's
 * "Skills published": each name, its description cut short, and where its
 * file is. Company content, shown as plain text; Iris doesn't fetch the
 * files. None before a Session has read them, as for the tasks.
 */
export function shownSkills(
  connection: Pick<Connection, "tasks" | "sessionId">,
): ShownSkill[] {
  if (!connection.tasks || connection.tasks.sid !== connection.sessionId)
    return [];
  const { skills } = connection.tasks.value;
  // A run stored before skills were listed kept only how many there were.
  if (!Array.isArray(skills)) return [];
  return skills.map(({ name, description, url }) => ({
    name,
    description: short(description),
    url,
    host: new URL(url).host,
  }));
}
