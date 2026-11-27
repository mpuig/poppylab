/**
 * What the page reads of a message before it sends it, with the agent
 * core's own rules (`typed-answers.ts`): a "yes" to Iris's question about
 * a sign-in, which has to open the Company's tab in the same keystroke (a
 * browser opens a tab only then), and whether a message needs a model at
 * all, so that a command or a scripted example never waits for the free
 * model's browser check. Everything else the server reads. Plain data.
 */
import { named } from "@poppy-lab/pap-agent/approval-question";
import { accountCommand } from "@poppy-lab/pap-agent/account-command";
import type { Nameable } from "@poppy-lab/pap-agent/company-names";
import { connectCommand } from "@poppy-lab/pap-agent/connect-command";
import { demoExamplesFor } from "@poppy-lab/pap-agent/demo-examples";
import {
  readApproval,
  SAYS_YES,
  yesOrNo,
} from "@poppy-lab/pap-agent/typed-answers";
import type { Choice, Message } from "./companies";
import type { CompanyState } from "./company-state";

/** A sign-in the page opens: at a Company, for read or change access. */
export type SignIn = { company: string; access: "read" | "write" };

/** Iris's question, while it is the last thing said: its buttons. */
export function openQuestion(messages: readonly Message[] | undefined) {
  const last = messages?.at(-1);
  return last?.role === "Own" && last.choices?.length
    ? last.choices
    : undefined;
}

/** The sign-in a button opens, if it is a sign-in button. */
export function signInOf(choice: Pick<Choice, "answer">): SignIn | undefined {
  const asked = choice.answer.signin as Partial<SignIn> | undefined;
  return asked &&
    typeof asked.company === "string" &&
    (asked.access === "read" || asked.access === "write")
    ? { company: asked.company, access: asked.access }
    : undefined;
}

/**
 * A typed "yes" to Iris's question about one sign-in: the sign-in to open
 * now, in this keystroke. Nothing for any other words or question: those
 * go to the server, which reads them the same way.
 */
export function signInAnswer(
  text: string,
  messages: readonly Message[],
): SignIn | undefined {
  const choices = openQuestion(messages);
  if (choices?.length !== 1) return undefined;
  const signIn = signInOf(choices[0]!);
  return signIn && yesOrNo(text, SAYS_YES.signin) === "yes"
    ? signIn
    : undefined;
}

/**
 * The buttons still worth pressing: one that decides a proposal goes once
 * the proposal no longer waits at that revision (its card or a standing
 * instruction decided it, or it ran out).
 */
export function liveChoices(
  choices: readonly Choice[],
  companies: readonly CompanyState[],
  now = Date.now(),
) {
  return choices.filter((choice) => {
    const ref = (choice.answer.approve ?? choice.answer.decline) as
      { company?: string; proposal?: string; revision?: string } | undefined;
    if (!ref) return true;
    const op = companies
      .find((c) => c.origin === ref.company)
      ?.operations.find((o) => o.operation_id === ref.proposal);
    return (
      !!op &&
      op.revision === ref.revision &&
      op.state === "proposed" &&
      Date.parse(op.expires_at) > now
    );
  });
}

/** The proposals a question's buttons decide, as an answer can name them. */
function asked(choices: readonly Choice[], companies: readonly CompanyState[]) {
  const seen = new Set<string>();
  return choices.flatMap((choice) => {
    const ref = (choice.answer.approve ?? choice.answer.decline) as
      { company?: string; proposal?: string } | undefined;
    const key = `${ref?.company} ${ref?.proposal}`;
    if (!ref || seen.has(key)) return [];
    seen.add(key);
    const company = companies.find((c) => c.origin === ref.company);
    const op = company?.operations.find((o) => o.operation_id === ref.proposal);
    return company && op ? [named(op, [company.name])] : [];
  });
}

/**
 * Whether the message can be answered without a model: one of demo mode's
 * scripted examples, one of Iris's own commands ("connect with Lantern",
 * "sign out of Harborline"), or an answer to the question Iris just
 * asked. The server decides the same way; this only spares the wait for
 * the browser check.
 */
export function typedWithoutModel(
  text: string,
  known: {
    messages: readonly Message[];
    companies: readonly CompanyState[];
    lab: readonly Nameable[];
  },
) {
  if (demoExamplesFor(text).length) return true;
  const connected = known.companies.map((c) => ({ url: c.url, name: c.name }));
  if (accountCommand(text, connected)) return true;
  const command = connectCommand(text, { connected, lab: known.lab });
  if (command && (!("rest" in command) || !command.rest)) return true;
  const choices = openQuestion(known.messages);
  if (!choices) return false;
  const proposals = asked(choices, known.companies);
  if (proposals.length)
    return readApproval(text, proposals, proposals.length > 1) !== undefined;
  // Go on with a request: that one needs the model, unless it is a no.
  if (choices.some((c) => "resume" in c.answer)) return yesOrNo(text) === "no";
  return yesOrNo(text, Object.values(SAYS_YES).flat()) !== undefined;
}
