# Poppy compared

Should a Company that already has an API, an MCP server or a website add
Personal Agent Protocol, and what does it get for it?

Poppy settles who the agent is, which user it acts for, what that user allowed,
and when a person has to say yes. It wraps the interfaces and replaces none, so
"Poppy or MCP?" compares different layers.

![A stack of three layers. At the top, a Personal Agent acting for a user. In the middle, Poppy, in green, settles four things: who the agent is, which user it acts for, what that user allowed, and when a person has to say yes. At the bottom, the Company's own interfaces stay as they are, OpenAPI, MCP, a support chat and the website, all listed in one document at /.well-known/poppy.json. Poppy wraps the interfaces and replaces none.](../../apps/playground/public/learn-media/diagrams/poppy-layers.svg "Poppy sits between the agent and the interfaces a Company already has, and settles four things without replacing any of them.")

## The options side by side

| Question                                                   | Public API + OAuth                                                      | MCP server                                                   | Browser automation                         | Poppy                                                                                                         |
| ---------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| How does an agent find what a Company offers?              | Developer docs, per Company                                             | A server URL it was given                                    | Pages built for people                     | One document, `/.well-known/poppy.json`, lists every interface                                                |
| Does the Company know the agent, the user and the session? | The agent if the developer registered a client; the user once signed in | Only once signed in; the agent through OAuth client metadata | Only the user, by their own login          | Yes, on every request, before sign-in: the agent verified against its keys, a pseudonymous user ID, a Session |
| Does the agent need the user's password?                   | No                                                                      | No                                                           | Usually, or the user's cookies             | No: OAuth on the Company's own consent page                                                                   |
| Can the user limit what the agent does?                    | With the Company's scopes                                               | With the Company's scopes                                    | No: the agent can do anything the user can | With scopes described for the approver, hinting what each changes                                             |
| Does a consequential change wait for the user?             | Not by any standard                                                     | Not by any standard                                          | No                                         | With Operations: exact terms, a revision, explicit approval                                                   |
| Can the agent reach the Company's own agent, or a person?  | No                                                                      | No                                                           | Through the website chat, as the user      | Yes: structured conversations, handoff to a person, Direct Conversations                                      |
| Does the agent learn what the Company won't do?            | No                                                                      | No                                                           | No                                         | Yes: excluded tasks with alternatives, a feedback endpoint                                                    |
| Does a new agent register with each Company?               | Yes                                                                     | Depends on the server                                        | No                                         | No: its `client_id` is a URL the Company fetches                                                              |

## Against a public API with OAuth

An agent developer registers an OAuth client, gets a secret and writes an
integration for that one Company: a thousand agents and a thousand Companies
make a million integrations.

Poppy keeps the API and OAuth and changes two things:

- **No registration.** The Company fetches the agent's `client_id`, an HTTPS
  URL, for its name and public keys
  ([§4.1](https://personalagentprotocol.org/docs/1.0/spec#agent-identity)), and
  the agent signs instead of sharing a secret. The same agent code works at
  every Company, which can still keep an allowlist.
- **Every request is attributed.** A Session header signed for that one request
  ([§5.2](https://personalagentprotocol.org/docs/1.0/spec#session-header))
  lets a Company rate-limit per user, keep state per Session and serve
  signed-out traffic it can reason about.

A plain API is enough when the only clients are ones the Company knows and
registers itself. Poppy earns its place when the Company wants any agent its
users choose, under the Company's rules.

## Against MCP

Poppy doesn't replace an MCP server: `poppy.json` lists it (`"type": "mcp"`),
and it can stay as it is, taking ordinary OAuth access tokens issued for it
([Company kit](https://personalagentprotocol.org/kit/company);
[guides](https://personalagentprotocol.org/docs/1.0/guides) for running both).

Poppy adds three things:

- **Attribution beyond the token.** A tool call belongs to a known agent, user
  and Session even when signed out. A server that ignores the Session header
  still works, but its calls belong to no Session.
- **Approvals with exact terms.** Operations returns the terms of a change,
  pins them to a revision and accepts only an approval of that revision, over
  MCP too (through `_meta`). A confirmation prompt the model can talk past
  guarantees nothing about what the user agreed to.
- **A person, when needed.** Conversations reach the Company's own agent and
  staff, which tools alone don't model.

An MCP server on its own is enough when its tools change nothing that matters
and the Company has no need to tell agents apart before sign-in.

## Against browser automation

Agents that drive a browser (computer use, headless scripts) work at any site
today, but the Company can't tell their traffic from the user's, it breaks when
a page changes, and the user can't tell which actions were the agent's.

Poppy doesn't ban the browser: browser join
([§6](https://personalagentprotocol.org/docs/1.0/spec#web-browsing)) lets an
agent's browser join the same Session with a cookie limited to the scopes the
user granted, for the parts that only exist as web pages.

## Against UCP

The Universal Commerce Protocol targets one domain, commerce: checkout, orders
and shopper identity. Poppy is domain-neutral: the same agent code works at
Lantern's noodle bar, Harborline's bank and Northwind's airline.

They can coexist. The guides say where a deployment using both can reuse an
authorization server and operator keys, and where requirements differ, so
neither protocol's token or signature is assumed to work in the other.

## What it costs a Company

Most of it is what a Company already runs. In the lab's gateway, the
[kit's architecture](https://personalagentprotocol.org/kit/company#architecture)
additions map to:

| Addition                                  | In Poppy Lab                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `poppy.json` and resource metadata        | Static JSON per Company ([`discovery.ts`](../../packages/pap-company/src/gateway/discovery.ts))                      |
| A token endpoint that verifies agents     | Client assertions checked against the agent's keys ([`tokens.ts`](../../packages/pap-company/src/gateway/tokens.ts)) |
| Session records                           | One map keyed by client, Session ID and user ([`sessions.ts`](../../packages/pap-company/src/gateway/sessions.ts))   |
| Session header checks in front of the API | One middleware; business routes don't change                                                                         |

Conversations, Operations and tasks are separate, optional modules. A Company
that only wants to be found can stop at a `poppy.json` without `auth`. The rest
comes one milestone at a time, each checked by the official validator
([Validator results](validator.md)).

## Go deeper

- [How it works](how-it-works/README.md): one screen at a time.
- [One task, request by request](one-task.md): every request for one change.
- [Conversations](conversations.md) and [Approvals](operations.md): the parts
  beyond a plain API.
- [Build a Company](build-a-company.md) and
  [Build a Personal Agent](build-an-agent.md): adopt it by milestone.
