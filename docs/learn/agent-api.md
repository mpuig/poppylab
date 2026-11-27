# The agent's API

This page lists what Poppy Lab's Personal Agent offers its own client apps,
and where each part is documented.

The API is the lab's, not the protocol's: Personal Agent Protocol says how an
agent talks to a Company, and leaves how a person reaches their agent to the
agent. Every request goes to `https://poppylab.dev/api/v1`. The lab's agent runs
as Iris, and the API's paths and fields carry no agent name.

| Part                       | What it is                                                                                                                                                                                                         | Documented in                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| **Accounts**               | An agent account is an opaque ID, its passkeys and an optional label, with no email, password or name. A browser and an app sign in to the same account.                                                           | [Build a native client](https://poppylab.dev/developers/native-client#create)    |
| **API sessions**           | Each signed-in device has a session of its own, with a 15-minute access token and a refresh token that works once. An account keeps at most 25.                                                                    | [Build a native client](https://poppylab.dev/developers/native-client#session)   |
| **Conversations**          | A conversation belongs to the account, holds the Companies the person adds, and shows the same in the playground and in an app.                                                                                    | [API reference](https://poppylab.dev/developers/api)                             |
| **Turns**                  | A message from the person, answered with the person's own model key, the lab's free model, or demo mode's guided examples.                                                                                         | [API reference](https://poppylab.dev/developers/api)                             |
| **Sentences as they come** | A turn sent with `Accept: text/event-stream` answers each of the agent's sentences as a `message.delta` event, then the result as `turn`.                                                                          | [Build a native client](https://poppylab.dev/developers/native-client#voice)     |
| **`spoken`**               | Each of the agent's messages and sentences carries a form to be read aloud: short, with no table, list or identifier. The agent's code writes it by fixed rules, never a model.                                    | [Build a native client](https://poppylab.dev/developers/native-client#voice)     |
| **Questions and answers**  | The agent asks when something waits for the person (a proposal, a sign-in, going on after one). An app shows the `choices`, or sends the person's words, such as "yes" or "approve the Lantern one", as a message. | [Build a native client](https://poppylab.dev/developers/native-client#talk)      |
| **Company sign-in**        | A one-time link to the Company's own consent page, opened in the app's browser sheet, for one account, conversation, Company and access.                                                                           | [Build a native client](https://poppylab.dev/developers/native-client#company)   |
| **Proposals**              | A change a Company holds for approval, with its exact terms, decided by the person in the app or in words.                                                                                                         | [Build a native client](https://poppylab.dev/developers/native-client#proposals) |
| **Events**                 | A conversation's changes as server-sent events, for an app that stays open: messages, Companies added or removed, sign-ins, proposals and their outcomes.                                                          | [Build a native client](https://poppylab.dev/developers/native-client#events)    |
| **OpenAPI document**       | Every operation and type of the API, the source of the reference page.                                                                                                                                             | [`openapi.json`](../../packages/pap-agent/openapi.json)                          |

The core that serves the API is [`packages/pap-agent`](../../packages/pap-agent),
described in [its design note](../pap-agent.md). This page doesn't cover the
protocol requests the agent sends to Companies on the person's behalf: those
are in [One task, request by request](one-task.md) and
[Build a Personal Agent](build-an-agent.md).
