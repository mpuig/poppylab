/**
 * "Connect with Lantern" in any language, or with a typo: the request the
 * User's own words make before any model (`connect-command.ts`) reads
 * English only, so a model turn can ask for the same with this tool. The
 * model gives the Company's name alone, and the request is carried out as
 * the typed one is: the name is matched against the lab's Companies and
 * the conversation's (`namedCommand`) and against nothing else, never made
 * into an address, and `performCommand` connects or removes it.
 *
 * Connecting is discovery, signed out: no sign-in starts, and the User
 * signs in on the Company's own page when a request needs it. Removing is
 * never done on the model's word: Iris asks, with the buttons the typed
 * "remove …" gives, and only the User's answer removes anything.
 *
 * The connected Company's tools are no part of the turn that connects it:
 * the model is told that the next message can ask it.
 */
import type { ApiTool } from "@poppy-lab/pap-client";
import type { HeldTurn } from "./chat-turn";
import { performCommand, type Choice } from "./company-commands";
import { namedCommand } from "./connect-command";
import { companyName, originOf } from "./connections";
import { localOrigins } from "./deployment";
import { nameable } from "./lab-companies";
import { spokenText } from "./spoken";

/** What the tool did in a turn, for the answer after it. */
export type CompaniesUse = {
  /** The model called it: the turn is about the conversation's Companies. */
  used: boolean;
  /** Iris's question, with its buttons, to show after the model's answer. */
  question?: { text: string; spoken: string; choices: Choice[] };
  /** The Inspector's lines, by the Company each was for, kept already. */
  lines: Array<{ company: string; line: string }>;
};

export const newCompaniesUse = (): CompaniesUse => ({ used: false, lines: [] });

/** Calls in one turn: as many as a conversation holds Companies. */
const MOST = 3;

/** An address, or anything that reads like one: never a name. */
const ADDRESS = /:\/\/|[/\\@]|^\S+\.[a-z]{2,}(?::\d+)?$/i;

/**
 * The tool, for a turn on a page that shows several Companies. Calls are
 * carried out one at a time, in the order the model made them.
 */
export function companiesTool(turn: HeldTurn, use: CompaniesUse): ApiTool {
  const { conversation: run, lab } = turn;
  const labNames = lab.map((c) => c.name).join(", ");
  let queue: Promise<unknown> = Promise.resolve();
  let calls = 0;
  const known = () => ({
    connected: run.connections.map((c) => nameable(c, lab)),
    lab,
  });
  const carryOut = async (input?: Record<string, unknown>) => {
    const { company, action = "connect" } = (input ?? {}) as {
      company?: unknown;
      action?: unknown;
    };
    if (
      typeof company !== "string" ||
      !company.trim() ||
      company.length > 120 ||
      (action !== "connect" && action !== "remove")
    )
      return {
        done: false,
        reason:
          "Give action connect or remove, and the company's name, at most 120 characters.",
      };
    use.used = true;
    if (++calls > MOST)
      return {
        done: false,
        reason: `At most ${MOST} companies are connected or removed in one turn.`,
      };
    if (ADDRESS.test(company.trim()))
      return {
        done: false,
        reason: `Companies are connected by name, never by an address. The lab's companies are ${labNames}. The user can type another company's address in the address box.`,
      };
    const command = namedCommand(action, company, known());
    const done = await performCommand(run, command, lab, localOrigins, false);
    // The same bookkeeping as the typed request's (`chooseCompany`).
    if (done.ask) run.removing = done.ask;
    if (done.changed) turn.scope.did.changed = true;
    if (done.choices?.length && (done.ask || "which" in command))
      use.question = {
        text: done.say,
        spoken: spokenText(done.say),
        choices: done.choices,
      };
    if (done.about)
      for (const line of done.trace)
        use.lines.push({ company: originOf(done.about), line });
    const connected = run.connections.map((c) => ({
      name: companyName(c),
      signed_in: !!c.accountToken && !c.accountUnavailable,
    }));
    return {
      done: done.changed
        ? action === "connect"
          ? "connected"
          : "removed"
        : done.ask
          ? "removal_waits_for_the_user"
          : "nothing_changed",
      // Iris's words for what happened, without a Company's own.
      what_happened: done.told,
      companies_now: connected,
      ...(done.changed && action === "connect"
        ? {
            note: "Discovery was read and nothing else was sent: the user is signed out there, and signing in is offered on that company's own page when a request needs their account. Its tools aren't part of this turn: the user's next message can ask it.",
          }
        : {}),
      ...(done.ask
        ? {
            note: "Nothing was removed. The user confirms or keeps it with the buttons under your answer.",
          }
        : {}),
    };
  };
  return {
    description: `Connect a company to this conversation, or remove one, when the user asks for it in any language ("conéctate con …", "connecte-toi à …", "treu …"). Give the company's name as the lab or the conversation calls it, never an address. The lab's companies are ${labNames}. Connecting reads the company's public discovery and nothing else; removing only asks the user, who confirms with a button. Then tell the user what happened, from the result.`,
    schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["connect", "remove"] },
        company: {
          type: "string",
          maxLength: 120,
          description: 'The company\'s name, such as "Lantern Noodle Bar".',
        },
      },
      required: ["action", "company"],
      additionalProperties: false,
    },
    execute: (input) => {
      const next = queue.then(() => carryOut(input));
      queue = next.catch(() => {});
      return next;
    },
  };
}
