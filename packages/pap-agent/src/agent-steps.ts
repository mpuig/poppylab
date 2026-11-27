import type { ProtocolEntry } from "./protocol-log";

export type StepHow = "API" | "Company's agent" | "sign-in" | "setup";
export type StepAccess = "view" | "view and change";
export type StepState = "done" | "failed" | "waiting";

/** What Iris did in one step, in plain words. */
export type AgentStep = {
  text: string;
  how: StepHow;
  access: StepAccess | null;
  state: StepState;
  /**
   * In a turn with several Companies (`several.ts`): the origin of the
   * Company the step was at, and the arguments of the call that made it,
   * as JSON, so the User sees what went to each Company.
   */
  company?: string;
  args?: string;
};

const UNSENT = "Did not send a request to ";

/**
 * What a step Iris stopped before asking waits for: a sign-in or a
 * permission; nothing, for any other step. Steps kept with a conversation
 * before 27 November 2026 said "Did not ask for", and conversations are
 * kept for seven days.
 */
export function unsentFor(step: Pick<AgentStep, "text">) {
  if (
    !step.text.startsWith(UNSENT) &&
    !step.text.startsWith("Did not ask for ")
  )
    return undefined;
  return step.text.includes("(sign-in needed)")
    ? ("sign-in" as const)
    : ("permission" as const);
}

/**
 * One readable line for a trace event: what Iris did, how, and with what
 * access. Pure, so it is tested on its own. An event it does not recognise
 * is kept in its own words rather than guessed at.
 */
export function agentStep(entry: ProtocolEntry): AgentStep {
  const { text } = entry;
  const state: StepState =
    entry.outcome === "waiting"
      ? "waiting"
      : entry.outcome === "error"
        ? "failed"
        : "done";
  // Iris stopped before asking the Company: never a request made.
  const unsent = /^Not sent · (?:GET|POST) (\S+) · (.+)/.exec(text);
  if (unsent)
    return {
      text: `${UNSENT}${unsent[1]} (${unsent[2]})`,
      how: "API",
      access: null,
      state,
    };
  if (entry.method && entry.url) {
    const read = entry.method === "GET" || entry.method === "HEAD";
    // The request was sent and the Company said no: its status and code.
    const refused = / · refused by the Company · (HTTP \d{3}(?: \S+)?)$/.exec(
      text,
    );
    if (refused)
      return {
        text: `The Company refused the request to ${entry.url} (${refused[1]})`,
        how: "API",
        access: read ? "view" : "view and change",
        state: "failed",
      };
    return {
      text: `${read ? "Read" : "Sent a request to"} ${entry.url}`,
      how: "API",
      access: read ? "view" : "view and change",
      state,
    };
  }
  const tool = /^MCP read tool completed: (.+)/.exec(text);
  if (tool)
    return { text: `Used ${tool[1]}`, how: "API", access: "view", state };
  if (/^Conversation (started|message)/.test(text))
    return {
      text: "Talked to the Company's own agent",
      how: "Company's agent",
      access: null,
      state,
    };
  if (/approval required/i.test(text))
    return {
      text: "Asked for your approval; nothing was done yet",
      how: "API",
      access: "view and change",
      state: "waiting",
    };
  if (/^Conversation handoff/.test(text))
    return {
      text: "Asked the Company to hand the conversation to a person",
      how: "Company's agent",
      access: null,
      state,
    };
  const session = /^Poppy [\d.]+ Session (signed in|signed out)/.exec(text);
  if (session)
    return {
      text: `Started a Poppy Session, ${session[1]}`,
      how: "setup",
      access: null,
      state,
    };
  const loaded =
    /^Loaded (\d+) (?:locally approved )?(API|MCP read) tools/.exec(text);
  if (loaded)
    return {
      text: `Found ${loaded[1]} ${loaded[2] === "API" ? "API" : "read-only"} tools at the Company`,
      how: "setup",
      access: null,
      state,
    };
  if (/sign(ed)?-?in|grant revoked/i.test(text))
    return { text, how: "sign-in", access: null, state };
  return { text, how: "setup", access: null, state };
}
