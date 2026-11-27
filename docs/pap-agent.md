# The agent's core

`packages/pap-agent` (`@poppy-lab/pap-agent`) is the Personal Agent without a channel: conversations with Companies over PAP 1.0, their storage, the model turn and everything around it. The playground's page is one client of it. An OpenAI-compatible API, an MCP server for harnesses such as Claude Code or Codex, messaging channels such as Telegram and a mobile app built outside this repository are meant to be others, all on the same conversations.

It is plain TypeScript with no Next.js import, and runs on Workers and on Node. It uses `@poppy-lab/pap-client` for the protocol and `@poppy-lab/llm-adapters` for the model, which stay packages of their own.

## What is in it

Each module is its own entry point (`@poppy-lab/pap-agent/<module>`), so a page imports only what it shows; `@poppy-lab/pap-agent` itself is the channel-neutral API.

| Part                      | Modules                                                                                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversations and storage | `runs.ts` (the run, its lifetime, locking, the conversations list, the `Backend` interface), `sealed.ts` (sealing values at rest), `run-size.ts` (the run's bounds)                                                                               |
| Connections to Companies  | `runtime.ts` (the `Run` and `Connection` types, identity, Sessions, requests, the tools of each interface), `connections.ts`, `connecting.ts`, `removing.ts`, `lab-companies.ts`, `company-names.ts`, `company-commands.ts`, `connect-command.ts` |
| Routing                   | `routing.ts` (`turnConnection`: which Company a turn is for)                                                                                                                                                                                      |
| The turn                  | `chat.ts` (`chatTurn`: one Company, several, demo mode, the agent's own answers), `several.ts`, `conversations.ts` (a Company's agent and Direct Conversations)                                                                                   |
| Demo mode                 | `demo-examples.ts` (the scripted examples and the suggestions, `DEMO_SUGGESTIONS`), `demo-changes.ts`, `demo-text.ts`, `demo-tool.ts`, `demo-fdx.ts`, `demo-espi.ts`, `demo-pay-bill.ts`                                                          |
| Approvals                 | `operation-store.ts`, `operation-validation.ts`, `operation-presentation.ts`, `standing-instructions.ts`, `auto-approval.ts`                                                                                                                      |
| Sign-in                   | `account.ts` (`accountAction`, `readAccount`: sign-in, sign-out, approvals, Use FDX and ESPI, removal), `sign-in-callback.ts`, `sign-in-cookie.ts`, `token-response.ts`, `account-permissions.ts`, `account-recovery.ts`, `domain-extension.ts`   |
| What the page is answered | `conversation-view.ts` (the reload), `transcript.ts`, `direct-state.ts`, `shown-tasks.ts`, `discover.ts`, `conversation-list.ts`                                                                                                                  |
| Bounds and the Inspector  | `limits.ts` (the public budgets), `inspector-log.ts`, `protocol-log.ts`, `spec-sections.ts`, `agent-steps.ts`                                                                                                                                     |
| The channel-neutral API   | `api.ts`, `api-events.ts`, `api-http.ts`, `openapi.ts`, `identity.ts`, `web.ts`, `agent.ts`                                                                                                                                                       |

The playground keeps what is only its own: the page and its components, the guide, Learn, the model settings, the Durable Object that stores conversations on Workers (`lib/visitor-storage.ts`), and its configuration of the core (`lib/agent.ts`).

## Two layers: the turn, and the API

Every function that does something for a conversation takes a `Caller` and answers a `Reply` (`web.ts`): a status, a JSON body (or a statement's bytes) and its headers. A channel turns its own request into the one and the other into its own response.

- **The page's contract.** `chat`, `account`, `accountView`, `discover`, `signInCallback`, `conversationList` and `conversationAction` take a Fetch `Request` and a cookie jar and answer a `Response`, in exactly the shapes [chat continuity](chat-continuity.md#what-each-route-takes-and-answers) describes. The playground's routes are each three lines: they hand the request and `cookies()` to one of these.
- **The channel-neutral API** (`api.ts`) is the same turns in plainer terms, as typed functions. A channel that isn't the page uses these.

| Function                                                                | What it does                                                                                                                 |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `startConversation(caller, { company? })`                               | A new conversation, with no Company or with the one at `company`, discovered and connected signed out                        |
| `getConversation(caller, id)`                                           | The conversation now: its Companies, what was said, every proposal                                                           |
| `sendMessage(caller, id, { text, company?, model? })`                   | The User's message; `company` is a Company the User chose for it. Without it the agent works out which, or asks with choices |
| `answerChoice(caller, id, { answer, model? })`                          | The answer one of the agent's choices carries, in place of a message. A choice's label is never sent as words                |
| `decideProposal(caller, id, { proposal, company, revision, decision })` | Approve or decline a proposal, found by its Company and its ID; an approval covers exactly that revision                     |
| `startSignIn(caller, id, { company, access? })`                         | The Company's consent page to open; the agent never sees a password                                                          |
| `conversationEvents(caller, id, { signal })`                            | The events that come later: `state` first, then what changes                                                                 |

Each answers `{ ok: true, value }` or `{ ok: false, status, code?, error }`, where `error` is written for the User and can be shown as it is.

**What goes out.** A message (`AgentMessage`) has its `text` and who it is `from`: `user`, `agent` (with `company` for a turn with that Company, without it in the agent's own voice about the conversation) or `company` (a Company's own words, with their `author`, which a channel shows as the Company's and never as the agent's). It may have `choices` (quick replies, each a `label` to show and an `answer` to send back), `links` (the addresses in the text, with a token or signature in them replaced by "…", as the page shows them), the `steps` of what the agent did and the Companies' exact `data`. A turn answers the messages it added, the User's line first, and the conversation's state, with `replaced` when the conversation took back what it showed before (a Company stopped taking the sign-in, a Company was removed). A proposal comes with its exact `terms`, its `revision`, its Company's `summary` as the Company's words, its `state` and when it expires.

**Events.** A sign-in finishes in the Company's tab, a proposal runs out or comes back with new terms, a Company writes in a Direct Conversation: these happen after the turn that answered. They are read from the stored conversation, which every channel and request writes to, so a channel learns of what another did without a message bus. `conversationEvents` reads it every two seconds and says what changed (`eventsBetween`): `message`, `messages.replaced`, `signin.completed`, `access.lost`, `signout`, `proposal.created`, `proposal.expired`, `proposal.replaced`, `proposal.updated`, `company.added`, `company.removed` and `conversation.ended`. A proposal's expiry is written nowhere, so it is told from the two readings' times. A Company's message in a Direct Conversation is an event once a request has read it from the Company, as the page's next action does; the stream itself sends nothing to any Company.

## Over HTTP: `/api/v1`

The playground serves the API at `/api/v1` (`app/api/v1/[...path]/route.ts`, which hands each request to `v1` in `api-http.ts`). [`openapi.json`](../packages/pap-agent/openapi.json) describes it for a client app, and `/api/v1/openapi.json` serves the same document; both come from `openapi.ts`, and a test holds every route to it and checks real answers against its schemas, member by member.

| Method and path                                                 | Body                                                      | Answers                             |
| --------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------- |
| `POST /api/v1/conversations`                                    | `{ company? }`                                            | 201 `ConversationState`             |
| `GET /api/v1/conversations/{id}`                                |                                                           | `ConversationState`                 |
| `POST /api/v1/conversations/{id}/messages`                      | `{ text, company?, model? }`                              | `TurnResult`                        |
| `POST /api/v1/conversations/{id}/answers`                       | `{ answer, model? }`                                      | `TurnResult`                        |
| `POST /api/v1/conversations/{id}/proposals/{proposal}/decision` | `{ company, revision, decision: "approve" \| "decline" }` | `{ proposal, state }`               |
| `POST /api/v1/conversations/{id}/sign-ins`                      | `{ company, access?: "read" \| "write" }`                 | `{ url }`                           |
| `GET /api/v1/conversations/{id}/events`                         |                                                           | `text/event-stream` of `AgentEvent` |
| `GET /api/v1/openapi.json`                                      |                                                           | the OpenAPI 3.1 document            |

`model` is `{ provider, apiKey?, model? }` with the User's own key; without it a turn runs in demo mode, which runs the scripted examples only. Errors are `{ code?, error }` with the status: 400 refused before anything was sent, 403 not from the playground's own origin, 404 no such conversation for this user, 409 another request holds the conversation, 410 the conversation has ended and is read-only. The event stream sends `retry: 3000`, then each event under its `type` as the SSE event name, and a comment after every reading; it closes after five minutes or when the conversation ends, and a client opens it again and starts from the new `state`.

Today a request is the visitor's, by the playground's cookie, and a request that changes anything must come from the playground's own origin. A request with an `Authorization` header is refused with 401 `api_session_unsupported` until API sessions exist (see below).

## Storage

A conversation is one stored value, kept under its user. The core defines the store (`Backend` in `runs.ts`): `get`, a compare-and-set `put`, `remove`, `list` by prefix, and a fixed-window `count` for the budgets. Locking a conversation for a request is a compare-and-set on its version, so it holds across Worker isolates.

- A Node process that configures nothing keeps conversations in memory and in the encrypted vault, as local development always has.
- On Workers the core has no file system and refuses to guess: a channel names its store with `configureStorage(open)`, opened on the first request that needs it, since a Worker's bindings exist only while it serves one. The playground's is the visitor's Durable Object, with every value sealed under `POPPY_STATE_KEY` (`sealedBackend`).
- Tests and a channel with a store of its own can set one directly with `configureBackend`.

What is stored keeps its shape. A conversation stored before the core was a package reads and goes on as before, and `readRun` still reads the shape from before a conversation held several Companies. `apps/playground/app/api/account/stored.test.ts` checks it with two conversations captured as production stores them.

## Identity

Every conversation is kept under an agent user, and a `Caller` says which one a request is for (`user(create)`), whether the channel vouches that the request is that user's own (`authentic`), where the agent is served (`origin`, which says where the lab's Companies are) and how a sign-in is bound to the user who started it (`signIns`: `bind`, `holds`, `release`).

- **The page's visitor** (`browserCaller`): the SHA-256 of the visitor cookie, `authentic` for a same-origin request, and a cookie for each sign-in, sent only to the callback.
- **A channel's own user** (`channelCaller`, `channelUser`): a Telegram chat, say, is mapped to an agent user the first time the channel names it, kept as a link record of its own, so that a later step can point it at another agent user when the person links their accounts. The channel binds a sign-in in its own way.
- **Next, not built yet** (`identity.ts` has their types): an agent account a person signs in to with a passkey, to which visitors and channel users are linked; and an API session for each device of a client app, started with the account's passkey and presented as a bearer token on `/api/v1`, listed and ended one device at a time.

## How a channel plugs in

1. Configure the core once, before the first request: `configureAgent({ name })`, the agent's name in its own sentences, and on Workers `configureStorage(open)`.
2. Make a `Caller` for each request: `browserCaller(request, cookies)` for a browser, `channelCaller({ user: await channelUser("telegram", chatId), origin, signIns })` for a channel with users of its own.
3. Call the API: `startConversation`, then `sendMessage` or `answerChoice` for each thing the user says or presses; show each message by its `from`, each choice as a button that sends its `answer`, each proposal with its terms and an approve and a decline; open `startSignIn`'s `url` for the user; follow `conversationEvents` while the user is there.

The playground does all of this for its own page through the page's contract, and serves the API for any other client.

**The agent's name** is configuration, never the core's. `configureAgent({ name: "Iris" })` is what the playground passes (`lib/agent.ts`); the model's system prompt and every sentence the agent says in its own voice use it ("Iris connected it to this conversation", "Approved by Iris on your standing instruction"). A page that renders the core's sentences in the browser can't count on that call having run in each bundle, so a build may also give `AGENT_NAME`, which the bundler writes into the code: the playground's `next.config.ts` does. With neither, the agent is called "Agent".

Some names on the page's wire still say Iris, and change only with the page, in one coordinated step: a chat answer's `mode: "iris"` for the agent's own words (to become `"agent"`), and the page's message role `"Iris"` (`app/playground/companies.ts`, to become `"Own"`).

## Two modes

- **Full agent.** The core runs its own loop: it picks the Company, calls the model with that Company's tools, keeps the conversation, asks for approvals and signs in. Every channel above uses this mode.
- **Protocol toolbox** (designed here, built later). A harness such as Claude Code or Codex brings its own model and loop and needs the protocol, not another agent. An MCP server would offer the core's pieces as tools: discover a Company, start a Session, list its tasks and tools, call one, read and answer a Company's agent, start a sign-in and wait for it, list the proposals and ask the User to approve one. The core keeps the conversation, the Sessions, the tokens and the proposals, so a token still goes only to the Company that issued it and nothing is performed without the User's approval: approving would never be one of the harness's tools, only asking the User to approve in the channel the User trusts (a link to the playground, say). What the harness is told is the Companies' content as data, as the model is told today.

## Checks

The core's own tests run with `pnpm --filter @poppy-lab/pap-agent test`, and read the agent's sentences as the playground names it. The playground's tests drive its routes, the stored conversations and `/api/v1` against the core; its end-to-end tests run the lab's real Companies in process.
