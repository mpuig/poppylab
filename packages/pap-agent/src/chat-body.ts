import { agentName } from "./agent";
import { readAnswer, type Answer } from "./company-commands";
import type { DirectAction } from "./conversations";
import { demoExamplesFor, demoGuidedReply } from "./demo-examples";
import { labCompanies } from "./lab-companies";
import { UserFacingError } from "./user-error";
import { json, type Caller, type Reply } from "./web";

/** A chat request's body, as the page sends it. */
export type ChatBody = {
  /**
   * The Company the page shows, as a page with one Company sends it:
   * where a conversation unknown here starts, and otherwise the
   * Company the turn is for, as `company` says it.
   */
  url?: unknown;
  /** The Company this turn is for, by origin, when the User chose it. */
  company?: unknown;
  message?: unknown;
  /**
   * In place of `message`: what one of the buttons under Iris's own
   * answer carries (`Choice.answer`). It names Companies by origin and
   * is never read as words.
   */
  answer?: unknown;
  provider?: unknown;
  apiKey?: unknown;
  model?: unknown;
  /** §8.10: the User's own action on a Direct Conversation; no model. */
  direct?: unknown;
  /**
   * `true` from a page that shows several Companies. Only then are the
   * User's words read for connecting or removing one: a page that shows
   * one Company could not show, or speak to, a second.
   */
  companies?: unknown;
};

/** A chat request that passed its checks, read into what the turn uses. */
export type ChatRequest = {
  /** Its addresses checked: each a string of at most 2048 characters. */
  body: ChatBody & { url?: string | undefined; company?: string | undefined };
  direct: DirectAction | undefined;
  /** A button's answer that isn't a message: it names Companies. */
  pressed: Exclude<Answer, { message: string }> | undefined;
  /** The User's words, or the scripted example a button sends as them. */
  written: string;
  provider: string;
  modelConfig: { apiKey: string | undefined; model: string | undefined };
};

const directActions: readonly DirectAction[] = [
  "accept",
  "decline",
  "start",
  "say",
  "close",
];

/**
 * Checks a chat request's body before anything is done with it: what it
 * refuses is refused before the conversation is read, or a Company or a
 * model asked. Throws `UserFacingError` for the refusals a turn answers
 * as its own error, and gives the others as `refused`.
 */
export function checkChatBody(
  value: unknown,
  caller: Caller,
): ChatRequest | { refused: Reply } {
  const body = value as ChatBody;
  if (
    body.direct !== undefined &&
    !directActions.includes(body.direct as DirectAction)
  )
    throw new UserFacingError("Unknown Direct Conversation action.");
  const direct = body.direct as DirectAction | undefined;
  const address = (value: unknown): value is string | undefined =>
    value === undefined || (typeof value === "string" && value.length <= 2048);
  // A button's answer comes in place of a message, never with one, and
  // never as one of the User's own Direct Conversation actions.
  const answer = readAnswer(body.answer);
  if (
    body.answer !== undefined &&
    (!answer || body.message !== undefined || direct)
  )
    throw new UserFacingError(
      `Send a message, or the answer one of ${agentName()}'s buttons carries, and not both.`,
    );
  // The button of one of demo mode's scripted examples sends it as the
  // User's message. Only the demo's own words are taken so, never a
  // Company's: anything else is refused.
  if (
    answer &&
    "message" in answer &&
    !demoExamplesFor(answer.message).length &&
    !demoGuidedReply(labCompanies(caller.origin).map((c) => c.id)).choices.some(
      (c) => c.message === answer.message,
    )
  )
    throw new UserFacingError(
      "That button is for an example the demo doesn't have. Type your request instead.",
    );
  const pressed = answer && !("message" in answer) ? answer : undefined;
  const written =
    answer && "message" in answer
      ? answer.message
      : typeof body.message === "string"
        ? body.message
        : "";
  if (
    !address(body.url) ||
    !address(body.company) ||
    (!pressed && (!written.trim() || written.length > 2000))
  )
    throw new UserFacingError(
      "Enter a Company URL and a message of at most 2000 characters.",
    );
  if (
    (body.apiKey !== undefined &&
      (typeof body.apiKey !== "string" ||
        body.apiKey.length > 2048 ||
        /[\r\n]/.test(body.apiKey))) ||
    (body.model !== undefined &&
      (typeof body.model !== "string" ||
        body.model.length > 120 ||
        !/^[a-zA-Z0-9._:/-]*$/.test(body.model)))
  )
    throw new UserFacingError("Invalid model configuration");
  const localDev = caller.localDev;
  if (
    body.provider &&
    body.provider !== "demo" &&
    !localDev &&
    !body.apiKey &&
    !direct
  )
    return {
      refused: json(
        { error: "Add your API key in Model settings." },
        { status: 400 },
      ),
    };
  // Public: only the offered providers, each with the visitor's own key.
  if (
    !localDev &&
    body.provider !== undefined &&
    !["demo", "openai-compatible", "anthropic"].includes(String(body.provider))
  )
    return {
      refused: json({ error: "Unsupported model provider." }, { status: 400 }),
    };
  if (body.apiKey && body.provider === "ollama")
    return {
      refused: json(
        { error: "Ollama does not use an API key." },
        { status: 400 },
      ),
    };
  return {
    // The checks above narrowed `url` and `company`.
    body: body as ChatRequest["body"],
    direct,
    pressed,
    written,
    provider: typeof body.provider === "string" ? body.provider : "demo",
    modelConfig: {
      apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
    },
  };
}
