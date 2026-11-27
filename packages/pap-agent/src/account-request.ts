import type { Connection, Run } from "./runtime";
import type { Caller, Reply } from "./web";

/** What the page asks of the account route. */
export type Action = {
  action: string;
  /**
   * The Company the action is for, by origin. A conversation with one
   * Company may leave it out; with several it has to be there.
   */
  company?: unknown;
  access?: unknown;
  id?: string;
  revision?: string;
  /**
   * The User's standing instruction: for an agent approval (§5), or for
   * the line about terms it leaves to the User (`not_applied`).
   */
  instruction?: unknown;
  /** `not_applied`: the hour's limit the page says holds the terms back. */
  allowance?: unknown;
  /** `fdx`, `espi`: Use FDX or Use ESPI on or off. */
  enabled?: unknown;
  /** `fdx_statement`: which statement of which shared account. */
  accountId?: unknown;
  statementId?: unknown;
  /**
   * `signin`, in answer to the agent's question about it: what the User
   * typed, or `true` for the question's button (`account-sign-in.ts`).
   */
  said?: unknown;
  /**
   * `approve`: `typed` when the User approved in their own words in the
   * chat, which the approval then says (`input_type`); a button otherwise.
   */
  input?: unknown;
};

/**
 * One account action, let in by the route's guard (`account.ts`): its
 * conversation, held, and the connection to the Company it is for.
 */
export type AccountRequest = {
  run: Run;
  connection: Connection;
  caller: Caller;
  body: Action;
  /**
   * The lines this request writes for the Inspector. The answer carries
   * them, and they are kept with the conversation as lines of the account
   * that was signed in when the request began.
   */
  trace: string[];
  /** Lines of one answer, kept as well. */
  said: (...lines: string[]) => string[];
  /**
   * A line the page writes itself, because no answer can carry it: kept
   * in the same words, and never answered, or the page would list it twice.
   */
  written: string[];
  /**
   * Iris already knew that the Company no longer takes the sign-in. An
   * action in which it learns that drops what it showed with the account.
   */
  knewLost: boolean;
  /**
   * The other Companies whose accounts could be in the proposal the
   * action is about: its lines are kept as holding them too.
   */
  others: readonly string[];
  /**
   * An approval went to the Company: a failure with no answer may mean it
   * was performed.
   */
  operationRequested: boolean;
};

/** What one action does, once the route's guard let it in. */
export type AccountHandler = (request: AccountRequest) => Promise<Reply>;
