/**
 * A Company only receives what was asked of it. Every tool a turn offers
 * the model calls one Company, with that Company's connection: its API or
 * MCP tools, its agent's conversation, the domain extension's tools, its
 * excluded tasks and its feedback. `runtime.connect` puts each behind
 * `notAddressed`, so a call to a Company the User didn't address in this
 * turn sends nothing, and the model is told why.
 *
 * The User addressed a Company when the turn was asked of it by a choice
 * made for this request (`chosen`: the User's own pick of it on the page,
 * with a button or in answer to Iris's question; the Company their own
 * "connect with … and …" named; the model's choice of it for the request;
 * a scripted example's Company; each Company a task spans together, such
 * as reading a bill at one and paying it at another), or when the request
 * names it. A turn that went to a Company only because it is the
 * conversation's only one, or the last turn's, is addressed to it unless
 * the request names other Companies and not it: "connect with Lantern",
 * said in a conversation with Fernwick alone, asks nothing of Fernwick.
 *
 * Plain data and no I/O.
 */
import { pointsAt, type Nameable } from "./company-names";
import { companyName, originOf } from "./connections";
import type { Connection } from "./run-types";

/** What the turn was asked, and of whom. */
export type Addressed = {
  /** The request the turn answers, in the User's words. */
  asked: string;
  /** Every Company a request could name: the conversation's and the lab's. */
  companies: () => readonly Nameable[];
  /** The Companies the turn was asked of by a choice, by origin. */
  chosen: readonly string[];
  /** The turn connected or removed a Company, or asked to, on the User's word. */
  aboutCompanies?: () => boolean;
};

/** The Companies these words name by name, never by a word for their kind. */
const namedIn = (text: string, companies: readonly Nameable[]) =>
  companies.filter((c) => pointsAt(text, c) === "name");

const names = (companies: readonly Nameable[]) =>
  [...new Set(companies.map((c) => c.name))].join(", ");

/**
 * Why nothing may be sent to this Company in this turn, if nothing may:
 * the User's request names other Companies, not this one, and the turn
 * wasn't asked of it by a choice.
 */
export function notAddressed(
  connection: Connection,
  scope: Addressed,
): string | undefined {
  const here = originOf(connection);
  if (scope.chosen.includes(here)) return undefined;
  const named = namedIn(scope.asked, scope.companies());
  if (!named.length || named.some((c) => originOf(c) === here))
    return undefined;
  const name = companyName(connection);
  return `The user's request is about ${names(named)}, not ${name}. ${name} only receives what was asked of it, so nothing was sent to ${name}.`;
}

/**
 * Why a feedback report (§9.3) can't go to this Company, if it can't. It
 * reports "a User's task" that can't be done through this protocol at the
 * Company that takes it: one the User asked of that Company. So besides
 * `notAddressed`: never for a turn about which Companies the conversation
 * is connected to, and never with another Company named in the report.
 */
export function misaddressed(
  connection: Connection,
  scope: Addressed,
  report: readonly string[],
): string | undefined {
  const name = companyName(connection);
  if (scope.aboutCompanies?.())
    return `This turn is about which companies the conversation is connected to. That is no task ${name} can't do, so nothing was reported to ${name}.`;
  const elsewhere = notAddressed(connection, scope);
  if (elsewhere) return elsewhere;
  const here = originOf(connection);
  const others = report
    .flatMap((text) => namedIn(text, scope.companies()))
    .filter((c) => originOf(c) !== here);
  return others.length
    ? `The report names ${names(others)}. A report to ${name} describes a task asked of ${name}, and names no other company.`
    : undefined;
}
