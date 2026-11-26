# Conversation continuity and viewport composer

## Conversations have addresses

Each conversation is one run, and its ID is the page's address: `/playground/<id>`. A run holds the conversation's own words and lifetime, and a connection for each Company it works with, up to three (see [A conversation and its Companies](#a-conversation-and-its-companies)). `/playground` is a new, empty conversation; connecting to a Company starts the run and puts its ID in the address. The ID is a name, not a key: the server looks it up under the visitor's cookie, so the address opens nothing in another browser (the page says so and offers a new conversation).

- **Running:** 30 minutes from its start, at most five at a time. Requests name it in the `X-Poppy-Conversation` header; the server answers with the same header, so a request that named a conversation unknown here, and was answered in a new one, moves the address to the new ID. No cookie names a run any more.
- **Ended under an open tab:** a tab left open past the end still shows a message box, and isn't told. A request that names a conversation that has ended and is still kept is refused with 410 `conversation_ended` and the header `X-Poppy-Conversation-Ended` (`conversationEnded` in `lib/limits.ts`): nothing is sent to the Company and no new conversation is started in its place. The page then reads the conversation again and shows what History shows: the read-only notice, signed out, each proposal as it ended. What is on screen stays, and words that were not sent go back to the message box. The page also asks whenever it is looked at again (window focus, tab shown), so the notice usually comes before anything is typed.
- **Ended:** when it expires, is pushed out by a sixth, or the demo is reset, a conversation becomes read-only. Its tokens, keys, Session and pending sign-in are removed; the transcript, the Company and how its proposals ended stay. It is kept for seven days from its start, up to 20 conversations per visitor (the oldest ended ones go first). One in which nothing was said or signed in is dropped instead.
- **Transcript:** `history` is still cut to the model's last ten turns; `transcript` keeps the conversation for the page and resets wherever `history` does: sign-out empties it, and a sign-in, or the Company taking the access back, keeps only the entries shown while signed out (see [permission and consent](permission-consent.md)). Each entry says which Company it came from, and these rules apply to that Company's entries only. It holds what the page showed, so a reload or the History view shows it again: the User's words (those said in a Direct Conversation marked as such), each Company content entry with its author, and each answer with its label, its "What Iris did" steps and its "Data". None of that goes into `history`: the model is sent a turn's words only, and never Company content or the User's direct words. How an approval ended is the other way round: `history` gets a line that tells the model, and the transcript gets none, because the page showed the outcome on the operation's entry and gets it again with the run's operations. The transcript is bounded (`TRANSCRIPT_LIMITS` in `lib/transcript.ts`): 200 entries, 12,000 characters of words and 20,000 of data per entry, 30 steps per answer, and 256 KB in all. Over that, the oldest data goes first, then the oldest steps, then the oldest entries. It holds no tokens, headers or request bodies.
- **Inspector lines:** the run also keeps the Inspector's "Session & API calls" lines (`log`, `lib/inspector-log.ts`), so a reload, the History view and an ended conversation list them again. Each kept line is a time, the words the Inspector showed, with any query string cut, and the origin of the Company it was written for: no token, header, body or code. The chat and account routes keep the lines their answers carry, and the sign-in callback keeps its own line. Two lines the page writes itself are kept in the same words: "Applying your standing instruction", when the server's check agrees, and a statement download. "Standing instruction not applied" is written for every waiting change the instruction leaves to the User, with the reason its card gives: the terms aren't covered (over the limit, a refund, another currency), or the hour's allowance is used up. The instruction lives in the browser, so the page asks (`not_applied`); the account route makes the check again, writes the line in its own words and keeps it once for each reason, with the reason on the operation (`notApplied`), so a reload lists the line as it was and asks for nothing. Only which of the hour's two limits holds a covered change back is the page's word, since the page counts the hour over every conversation with the Company; when the run's own hour refuses an approval the page asked for, the route writes the line itself. The lines are bounded (`LOG_LIMITS`): 400 lines, 300 characters each and 80 KB in all, the oldest dropped first. The lines follow the conversation. A sign-in keeps only the lines written while no account was signed in, as the transcript does, and the line of each sign-in before it: "Direct Sign-In completed" says only that a sign-in happened and how, and names nothing an account holds, so two consents are both listed whether or not anything was said between them. Sign-out, and the revocation of an FDX consent or ESPI authorization, empty them with the transcript, what was written signed out included: the lines of that request are all that is listed afterwards, on the page and after a reload.
- **"Talk to <Company> yourself":** the link under the chat is offered when Iris holds a conversation with the Company's agent that a Direct Conversation can start from (§8.10 names a parent), as the server says it in every chat answer and on a reload (`directState`). It does not follow the transcript. Iris forgets that conversation at sign-out, and at a sign-in when the Company's answers show it belongs to another account; the link then goes, even if the page still shows an exchange with the agent from before any account access, and comes back with the next message to the Company's agent. While the Company no longer takes the sign-in the link is not offered either, since every request in the conversation would be refused until the User signs in again. A link already pressed is disarmed whenever there is nothing to talk from.
- **History view:** lists them (`GET /api/conversations`: names and times only) and links to each address. An entry names every Company of its conversation: `companies`, each with `origin`, `name` and `url`, in the order they were connected, next to `company` (the names in one line) and `url` (the first one's address), which a list with one name for each conversation reads. A conversation with no Company has an empty list, and `company` and `url` are "". A conversation is listed under its first request still shown, so one a sign-in or sign-out emptied reads "No messages yet" while it runs and is dropped once it ends.
- **Reset demo data:** a new conversation keeps what earlier ones changed at the Companies, because a Company's copy of its test customers belongs to the User ID Iris presents. The reset stores a new per-visitor epoch that goes into that User ID (`userFor`), so every Company meets the visitor as a new person and gives a fresh copy on the next connection. Running conversations end, since their Sessions belong to the person before. Locally the Companies share one copy unless `COMPANY_ISOLATION=visitor`, so the reset shows fresh data only on the deployed, per-visitor Companies.

## A conversation and its Companies

A conversation works with up to three Companies at once. The server takes that: a Company can be connected or removed at any moment, every request says which Company it is for, and what one Company's account showed never outlives that account in another Company's answer. The page still shows one Company: it reads the members it always read, which are the first Company's, and its requests name the Company it shows. The contract a page that shows several needs is in [What each route takes and answers](#what-each-route-takes-and-answers).

- **The run** (`Run` in `lib/runtime.ts`) is the conversation: who owns it (`visitor`, `epoch`), its lifetime (`expires`, `busy`, `created`, `archived`, `keepUntil`), its twenty turns (`calls`), its name (`title`) and its words in the order they were said (`history` for the model, `transcript` for the page, `log` for the Inspector).
- **A connection** (`Connection`, in `Run.connections`) is everything Iris holds for one Company: its address, the User ID Iris presents there, the Session and its key, the sign-in (tokens, scopes, the consent in progress), Use FDX or Use ESPI, the discovered Company, its proposals, the conversation with its agent, the hour's agent approvals, and the model's turns from before any access to its account (`publicHistory`). The runtime, the conversations with a Company's agent and the account actions take a connection and nothing else, so a token only goes to the Company that issued it. The User ID is worked out for each Company from the conversation's visitor (`userFor`), so two Companies of one conversation can't link it.
- **Which Company.** Every account action names its Company: `company` in the body of `POST /api/account`, the Company's origin (any address there names it; `connectionNamed` in `lib/connections.ts`). A proposal is found by its Company and its ID together. Without `company`, the Company the page shows names it, when it is one of the conversation's: the `X-PAP-Company` header, which the page has always sent with every account action. A conversation with one Company may leave both out. With several, one of them is required: without it the answer is 400 `company_required`, for a Company the conversation isn't connected to 400 `company_not_connected`, and in a conversation with none 400 `no_company`, and nothing is sent anywhere. The sign-in callback finds the connection whose sign-in waits for its `state`.
- **Which Company a turn is for.** `POST /api/chat` takes `company`, the origin of the Company the User chose for the turn, and still takes `url`, the Company a page with one Company shows: a conversation unknown here starts at `url`, and so does one that isn't connected to it, as before. `turnConnection(run, message, hint)` in `lib/routing.ts` then decides: the conversation's only Company; else the one the request names; else the one the last turn was with; else it asks. A deduction from the message is to replace the inside of that function, and what it could read is gathered next to it: `candidates(run)` gives each Company's name, whether it is signed in, how its discovery describes its APIs, the tasks it excludes and the tools its last turn loaded (`Connection.offered`: names, descriptions and required arguments, which is what the demo's rules and a model choose by), and `lastTurnCompany(run)` the Company the last turn was with. A `company` that isn't one of the conversation's is refused with 400 `company_not_connected`.
- **When Iris asks.** The answer is then Iris's own: `text` is "Which company is this for?" with the connected Companies named, `mode` is `iris`, there is no `from`, and `choices` lists a button for each Company (`{ label, say }`: pressing one sends `say` as the User's next message). Nothing is sent to any Company, the turn doesn't count, and the model isn't told. The request waits in the run (`waiting`); when the next message is the name of one connected Company (`answeredWith` in `lib/company-names.ts`: "Lantern", "for the bank, please"), that request is asked there. The page shows what was typed and the model gets the request. Any other message drops it.
- **What a chat answer says of its Company.** `from` is the Company the turn was with (`{ origin, name }`), each entry of `company` (the Company content of the turn) carries the same `from`, and the state members (`sessionId`, `signedIn`, `scopes`, `recovery`, `operations`, `excludedTasks`, `skills`, `direct`, `conversation`, `invitation`) are that Company's. An error answer carries `from` when the turn had got to a Company. An answer of Iris's own has no `from`; its state members are the first connection's, as on a reload, for the page that shows one Company.
- **A conversation with no Company** keeps its words. A message that names no conversation and no `url` starts one. A message is then answered by Iris, with the lab's Companies named and a button for each (`choices`), and nothing is sent.
- **"Connect with Lantern", typed in the chat.** The User's own message can connect a Company or remove one at any moment (`lib/connect-command.ts`, carried out by `lib/company-commands.ts`). The chat route reads it before any model or rule of the demo sees the message, and reads nothing else for it: not Company content, a tool's result, a model's answer, or the User's words to a Company in a Direct Conversation. English only. "Connect with …", "connect to …" and "disconnect from …" are only ever meant for this; "add …", "also …", "… too", "remove …", "drop …" and the like are also what a person says to a Company ("add a matcha ice cream"), so they count only when what follows is a Company's name and nothing else. A Company is matched by its name, the words its name begins with, and a few plain words listed for it in `labSites` (`packages/pap-core/src/lab.ts`: "the bank", "the airline"), against the lab's Companies and the connected ones and nothing else. A name is never turned into an address: for one that fits no Company, Iris says so, lists the lab's, and says another address can be typed in the address box. For words that fit two, it asks which. Connecting is discovery and `addConnection`, as from the page: nothing is sent on the User's behalf and no sign-in starts. Removing is `removeCompany`, with the same refusal. Iris answers in its own words (`mode` `iris`, no `from`): the Company's name, how its discovery describes what it offers, quoted, and that signing in is offered when a request needs the account. The model is told the turn without the Company's own words. When the message asks for something else as well ("connect with Lantern and show me the menu"), the rest is then asked of that Company: the answer is that turn's, with Iris's line in `before`. An answer after which the Companies are no longer the same carries `connections` and `former`, and after a removal `history` and `log` as they are left. The words are read only when the request says `companies: true`, which a page that shows several Companies sends; a page that shows one could not show or speak to a second, so there they stay an ordinary message.
- **A Direct Conversation (§8.10)** is with one Company, and the User's words go there as written, so their Company is never worked out from the words (`directConnection`): it is the one the request names, or the conversation's only one, or the only one that has the Direct Conversation, the invitation or the conversation the action is about. Otherwise the request is refused with 400 `company_required`.
- **Where each thing came from.** Each entry of `transcript`, each line of `log` and each turn of `history` carries `company`, the origin of the Company it came from, next to `signedOut` where that Company's account wasn't signed in. The origin names the Company, not its place in the list, so an entry still says where it came from after the Company is removed. The page is answered each entry and line with `from`, the Company's origin and its name to show (`{ origin, name }`, `forPage`), and never `company` or `accounts`.
- **What a reload is answered** (`GET /api/account?conversation=`, `lib/conversation-view.ts`): `connections`, one entry for each Company in the order they were connected, with its `origin` and `name` and its own state (`company`, the discovery; `url`, `signedIn`, `scopes`, `authPending`, `consentVersion`, `recovery`, `fdx`, `fdxConsent`, `espi`, `espiAuthorization`, `directConversation`, `operations`, `excludedTasks`, `skills`); `former`, the Companies that were removed, each with `origin`, `name`, `url` and the approvals it left with an unknown outcome; and `history` and `log` for the whole conversation. The members a page with one Company reads (`company`, `url`, `signedIn`, `scopes` and the rest of that list) are still at the top, with the same meaning: they are the first connection's, and those of no Company when the conversation has none. Sign-out, and the revocation of an FDX consent or ESPI authorization, answer with `history` and `log` as they are left, since with several Companies what came from the others stays.
- **Whose account could be in it.** A model is sent the last ten turns of the whole conversation, whichever Company each was with, so its answer to a turn with one Company can repeat what it read with another's account. Each entry of `transcript` and each turn of `history` therefore also lists the Companies whose accounts could be in it (`accounts`, by origin; `accountsIn` in `lib/transcript.ts`): the turn's own Company when it is signed in, and every account listed by a turn the model was sent with it. The demo's rules are sent no turns, so their answers list their own Company at most. `signedOut` is set, and a turn goes into `publicHistory`, only when the list is empty. A line of `log` lists them when one is another Company's, since a model can put what it read into the path of a request. A proposal is listed the same way, for the same reason: the model's request to one Company can name what it read with another's account, and the Company's terms then repeat it. The list is kept beside the connection's proposals (`Connection.operationAccounts`, by operation ID, only when one of the accounts is another Company's; `noteOperationAccounts` in `lib/operation-store.ts`, when the turn ends), and not in the proposal, which the page is sent whole. New terms that answer an approval keep the list of the terms approved, and so does a proposal that comes again under the same ID. The line the model gets about how an approval ended (`recordOutcome`) and the Inspector's lines of approving or retrying it list the proposal's accounts too. What was stored before this has no list: such a turn is taken to hold its own Company's account when that Company is signed in.
- **What a Company's sign-in, sign-out or lost access takes back** (`lib/transcript.ts`): what came from that Company, and what its account could be in. A sign-in that may be for another account, or an access the Company took back, removes what was shown with that Company's account and its proposals (`backToPublic`, `forgetLostAccount`); the model gets that Company's turns from before its account back, followed by the turns it still has with other Companies. Sign-out removes everything from that Company, signed-out turns included (`forgetCompany`). Each of them also removes the entries, turns and lines from another Company that list this Company's account, and the proposals at another Company that list it (`withdrawProposals`): summary, terms, result and the stored request, whether the proposal waited or had ended. One whose approval was sent with an unknown outcome stays, as it does at its own Company's reset. The cards go from the page, so Iris says why in a line of its own, kept as shown signed out and as coming from the Company that made the proposals, where it stays through every sign-in: "A proposal from Harborline Bank that waited for your approval no longer shows: it could hold details from your Lantern Noodle Bar account, which Iris no longer keeps. Nothing was approved. Ask Harborline Bank for the change again if you still want it." For proposals that had ended it closes with "What Harborline Bank already performed is not undone." The model isn't told. An answer to the request that caused it (sign-out, a revocation, `remove`, a turn or action in which the access was lost) then carries `connections` and `former` next to `history`, so the page drops those cards; the sign-in callback answers nothing, and the page's poll of the reload answer gets them. What names no Company and lists no accounts was stored before entries said either: it goes at any Company's reset, since it can't be told whose it was. With one Company these are the rules above.
- **Adding a Company.** `POST /api/discover` with the header `X-Poppy-Conversation` naming a running conversation connects the Company to that conversation (`connectCompany` in `lib/connecting.ts`, then `addConnection`): signed out, at any moment, up to three, each Company once. The answer is the Company's discovery, as for a new conversation, with the same conversation in the header. What the conversation holds stays as it is, a sign-in under way at another Company included. It is refused with 409 and words the page can show for a Company the conversation is already connected to (`already_connected`) and for a fourth one (`too_many_companies`), both before anything is fetched, and with 409 `busy` while another request holds the conversation. A request that names no conversation, or one unknown here, starts a new one as before; one that names a conversation that has ended is answered 410 `conversation_ended`.
- **Removing a Company.** The account action `remove`, with `company`, takes one out while the conversation goes on (`removeCompany` in `lib/removing.ts`). Signed in, its grant is revoked at the Company first, as sign-out does; a Company that can't be reached is removed all the same, and the answer says the grant wasn't revoked (`revoked: false` and a `notice` to show). Then `removeConnection`: its Session, sign-in and waiting proposals go, what was shown with its account goes, and what was shown signed out stays with its origin. The Company's name is kept (`Run.former`, read by `nameFor`). The answer carries `removed` (`{ origin, name }`), `revoked` when it was signed in, `trace`, and the conversation as it is left: `connections`, `former`, `history` and `log`. Any Company can be removed, whether or not this playground may sign in to it. It is refused with 409 `approval_unsettled`, the approvals in `operations`, and nothing sent or removed, while an approval sent to that Company has an unknown outcome: without the connection it could never be retried, and the same change could be asked for twice. The User retries it first. `removeConnection` itself still keeps such an approval in `former`, without its request, for a caller that removes one anyway.
- **Sign-in at several Companies.** A sign-in is one Company's: the account action `signin` names it, and the callback finds the connection whose sign-in waits for the OAuth `state` and keeps the tokens there and nowhere else. Each sign-in has a cookie of its own (`lib/sign-in-cookie.ts`): `pap_oauth_<state>`, with the `state` as its value, HttpOnly, SameSite=Lax, sent only to `/api/account/callback`, for five minutes. The callback completes a sign-in only for a browser that holds the cookie of that very `state`, and expires it. So two sign-ins can be under way in one conversation, at two Companies, and both complete in either order; before, one cookie held the last `state` only, and a second sign-in made the first one's callback fail. A new sign-in at the same Company replaces the one under way there and expires its cookie. Discovery that starts a new conversation expires the cookies of the sign-ins the visitor has under way, as it cleared the one cookie before, so none completes behind the conversation the page now shows; discovery that adds a Company to a conversation leaves them.
- **Conversations stored before this** are one object, with the Company's part among the conversation's own members. `readRun` in `lib/runs.ts` reads such a value as a conversation with one connection, wherever a run is read, and marks its entries with that Company; the next write saves the new shape. An ended conversation is never written again, so it is read this way for the seven days it is kept. Code from before this change can't read a run saved in the new shape.

### What each route takes and answers

What a page needs in order to show several Companies, member by member. Every request names its conversation in the `X-Poppy-Conversation` header, and every answer of a route that can start one carries the header back. A Company is always named by its origin; any address at that origin names it too.

```ts
/** A Company as the page is told of it. `origin` is what names it in a request. */
type CompanyRef = { origin: string; name: string };

/** A button: pressing it sends `say` as the User's next message. */
type Choice = { label: string; say: string };

/** One Company of the conversation, with its own state. */
type ConnectionView = CompanyRef & {
  company?: DiscoveredCompany; // its discovery, as POST /api/discover answers it
  url: string; // its address as it was connected
  signedIn: boolean;
  scopes?: string;
  authPending: boolean; // a sign-in is under way there, or a request holds the conversation
  consentVersion: number; // goes up with each completed sign-in there
  recovery?: {
    code: "account_unavailable";
    status: 401;
    next: "signin";
    error: string;
  };
  fdx: boolean; // Use FDX
  fdxConsent?: string;
  espi: boolean; // Use ESPI
  espiAuthorization?: string;
  directConversation: {
    direct: boolean;
    conversation: boolean;
    invitation: string | null;
  };
  operations: Operation[]; // its proposals
  excludedTasks: ShownTask[];
  skills: ShownSkill[];
};

/** A Company that was removed, and the approvals it left with an unknown outcome. */
type FormerView = CompanyRef & { url: string; operations: Operation[] };

/** A kept entry and a kept Inspector line. No `from`: Iris's own, or kept before entries said. */
type Entry = {
  role: "user" | "assistant" | "company";
  content: string;
  demo?: true;
  steps?: AgentStep[];
  data?: string;
  author?: string;
  note?: string;
  direct?: true;
  signedOut?: true;
  from?: CompanyRef;
};
type Line = { at: number; text: string; signedOut?: true; from?: CompanyRef };

/** The conversation's Companies, and its words. */
type Companies = { connections: ConnectionView[]; former: FormerView[] };
type Words = { history: Entry[]; log: Line[] };
```

**`GET /api/account?conversation=<id>`** answers

```ts
{ missing: boolean; conversation?: string; readOnly: boolean; keptUntil?: number }
  & Companies & Words
  // For the page that shows one Company: the first connection's state,
  // or that of no Company (signed out, nothing listed, `company` absent).
  & Partial<Omit<ConnectionView, "origin" | "name">>
```

**`POST /api/discover`**, body `{ url: string }`. With the header naming a running conversation it adds the Company to it; otherwise it starts a conversation. Both answer 200 with the `DiscoveredCompany` and the conversation in the header. Refusals when adding: 409 `{ code: "already_connected" | "too_many_companies" | "busy"; error }`, 410 `conversation_ended`, 422 `{ code; error; trace }` when discovery fails.

**`POST /api/account`**, body

```ts
{
  action:
    | "signin" | "signout" | "remove"
    | "approve" | "decline" | "retry" | "not_applied"
    | "fdx" | "espi" | "fdx_consent" | "fdx_revoke" | "fdx_statements" | "fdx_statement"
    | "espi_authorization" | "espi_revoke";
  company?: string; // required with several Companies, unless X-PAP-Company names one of them
  access?: "read" | "write"; // signin
  id?: string; revision?: string; // approve, decline, retry, not_applied: found at `company`
  instruction?: unknown; allowance?: unknown; enabled?: boolean;
  accountId?: string; statementId?: string;
}
```

Each action answers as before, for the Company named. What is new:

```ts
// Before anything is sent, status 400:
{ code: "company_required" | "company_not_connected" | "no_company"; error: string }
// signout, fdx_revoke, espi_revoke: the answer they had, and
Words // what the conversation still shows, before this request's own `trace` lines
  & Partial<Companies> // when proposals at other Companies went with the account
// An action in which the Company no longer takes the sign-in (401
// `account_unavailable`): `history` and `operations` as before, and
Partial<Companies> // when proposals at other Companies went with the account
// remove, status 200:
{ removed: CompanyRef; revoked?: boolean; notice?: string; trace: string[] } & Companies & Words
// remove, status 409:
{ code: "approval_unsettled"; error: string; operations: Operation[] }
```

**`POST /api/chat`**, body

```ts
{
  message: string;
  company?: string; // the Company the User chose for this turn
  url?: string; // the Company a page with one Company shows
  provider?: string; apiKey?: string; model?: string;
  direct?: "accept" | "decline" | "start" | "say" | "close";
  companies?: true; // a page that shows several Companies says so
}
```

answers, status 200,

```ts
{
  text: string;
  mode: "demo" | "direct" | "iris" | string; // "iris": Iris's own words; else the provider
  from?: CompanyRef; // the Company the turn was with; absent for Iris's own answers
  before?: string; // Iris's own line to show before `text`: it connected or removed a Company first
  choices?: Choice[];
  data?: string;
  trace: string[];
  company: Array<CompanyEntry & { from: CompanyRef }>; // the turn's Company content
  // The state of `from`; of the first connection when there is no `from`.
  sessionId?: string; signedIn: boolean; scopes?: string; recovery?: ConnectionView["recovery"];
  operations: Operation[]; excludedTasks: ShownTask[]; skills: ShownSkill[];
  direct: boolean; conversation: boolean; invitation: string | null;
}
  & Partial<Companies> // when the User's words connected or removed a Company
  & Partial<Words> // `history`: what the conversation shows now, before this turn; see below
```

`history` is in a chat answer when the turn took something back from the page: the Company no longer takes the sign-in (as before, with that Company's `operations`, and with `connections` and `former` when proposals at other Companies went with the account), or the User's words removed a Company (with `log`). The page then shows `history`, followed by what this turn adds: the User's message, `before`, the entries of `company` and `text`. An error answer has `error`, `code`, `stage` and `trace` as before, `from` when the turn had got to a Company, and `before`, `connections`, `former`, `history` and `log` when the User's words had changed the Companies before it failed. Refusals before anything is sent, status 400: `{ code: "company_not_connected" | "company_required" | "no_company"; error }`.

**`GET /api/conversations`** answers `{ conversations: Array<{ id; company: string; url: string; companies: Array<CompanyRef & { url: string }>; title?; created; active; until }> }`.

What a page that shows several Companies does with it:

1. Keep the list of Companies from `connections` and `former`: after a reload, after `remove`, and after any chat answer that carries them. Add a Company with `POST /api/discover` and the conversation's header, and then read the conversation again or add the Company itself, signed out.
2. Send `company` with every account action, and with a chat turn when the User chose a Company. Leave it out of a chat turn otherwise: the answer's `from` says where it went.
3. Label each message with `from.name`. A chat answer's state members belong to `from.origin`; when there is no `from`, take the Companies' state from `connections` if the answer has them and change nothing otherwise.
4. Render `choices` as buttons that send `say` as the User's message, and `before` as a line of Iris's ahead of the answer.
5. After `signout`, a revocation, `remove`, or a chat answer with `history`: show `history` (and `log`, then the answer's own `trace` lines) in place of what was on screen.
6. Poll the reload answer for the Company whose sign-in is under way (`connections[i].authPending`, `signedIn`, `consentVersion`). Two can be under way at once.

## Sign-in

The callback previously cleared every history entry on successful consent, and the UI polling path independently called `setMessages([])`. First sign-in now snapshots and retains the pre-account conversation (bounded to the existing 10-message model history), in the Company's connection (`publicHistory`). Polling renders the server's returned history. Refresh uses the same persisted history.

Later consent may select a different account, so it retains only this public prefix, never private account turns or pending approvals, unless the Company's answers on a conversation that used the account show the sign-in is for the same one (see [permission and consent](permission-consent.md)). Legacy signed-in runs without a recorded public prefix fail closed and do not carry private history across consent. Sign out clears both histories. Messages already discarded by the old behavior cannot be recovered from the run.

Callback regressions cover initial public continuity, immutable copy, later account-context separation, invalid grants and failed consent. Browser fixture test confirmed both prior messages remain after the simulated consent completion; no real grants issued.

## Composer

The run view is a viewport-height flex workspace. Main/conversation/transcript use `min-height: 0` so content can shrink inside the available height; the transcript owns scrolling, not the document. Composer and conversation header do not shrink. Setup scrolls within its own bound when expanded. The introductory heading disappears once the conversation has content; the secondary note/footer do not occupy bottom space in run view. Inspector and Identity retain normal document scrolling.

Height follows `visualViewport.height` when available, with a dynamic viewport fallback and safe-area padding. This supports a shrinking visual viewport, but real mobile keyboard behavior has not been tested on hardware.

Measured browser fixtures:

- 1044×798: composer bottom 798, document height 798; transcript scrollable.
- 390×844: composer bottom 844, document height 844; no horizontal overflow.
- 390×500: composer bottom 500, transcript remains visible (135px).
- New message + fixture reply: composer unchanged at 798 and transcript scrolled to the latest reply.
- Expanded mobile model settings: composer stays at 844; setup becomes scrollable.

Review in-thread, no independent reviewer. Two paired screenshot batches; detector `[]`. Final captures: `screenshot-1792514066758.png` and `screenshot-1792514091954.png` under the agent-browser screenshots directory. On desktop-to-mobile resize the transcript did not consistently stay at its absolute bottom; the composer remained correctly pinned. New messages scroll to the latest content. No more visual polishing in this pass.

Validation: 278 workspace tests (110 Playground tests), typecheck, lint, production build and formatting pass. No paid model calls or business changes used.
