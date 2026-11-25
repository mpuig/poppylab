# Poppy compared

Personal Agent Protocol isn't a new kind of API. It's the agreement around
the interfaces a Company already has: who the agent is, which user it acts
for, what that user allowed, and when a person has to say yes. The
interfaces themselves stay OpenAPI, MCP, a support chat or the website.

So the useful question isn't "Poppy or MCP?" but "what does each layer give
the Company and the user?" This page answers it for the four options people
usually weigh.

## The short version

| Question                                                    | Public API + OAuth                        | MCP server                                    | Browser automation                         | Poppy                                                                                          |
| ----------------------------------------------------------- | ----------------------------------------- | --------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| How does an agent find what a Company offers?               | Developer docs, per Company               | A server URL it was given                     | It reads pages built for people            | One document at `/.well-known/poppy.json` lists every interface                                |
| Does the Company know which agent is calling?               | Only if the developer registered a client | Through OAuth client metadata, when signed in | No: it looks like the user's browser       | Yes, on every request, signed in or out, verified against the agent's published keys           |
| Does it know which user, and which session?                 | Only once signed in                       | Only once signed in                           | Only by the user's own login               | Yes: a pseudonymous user ID and a Session on every request, before sign-in                     |
| Does the agent need the user's password?                    | No                                        | No                                            | Usually yes, or the user's cookies         | No: OAuth on the Company's own consent page                                                    |
| Can the user limit what the agent does?                     | With the Company's scopes                 | With the Company's scopes                     | No: the agent can do anything the user can | With the Company's scopes, described for the person approving, with hints on what each changes |
| Does a consequential change wait for the user?              | Not by any standard                       | Not by any standard                           | No                                         | With Operations: exact terms, a revision, an explicit approval, and at-most-once retries       |
| Can the agent talk to the Company's own agent, or a person? | No                                        | No                                            | Through the website chat, as the user      | Yes: conversations with structured data, handoff to a person, and Direct Conversations         |
| Does the agent learn what the Company won't do through it?  | No                                        | No                                            | No                                         | Yes: excluded tasks with alternatives, and a feedback endpoint                                 |
| Does a new agent need to register with each Company?        | Yes                                       | Depends on the server                         | No                                         | No: its `client_id` is a URL the Company fetches                                               |

The rest of this page explains the rows that matter most for each option.

## Against a public API with OAuth

This is what most Companies have, or could ship quickly. An agent developer
reads the docs, registers an OAuth client (often with a manual review), gets
a client secret and writes an integration for that one Company. A thousand
agents and a thousand Companies means a million integrations, and the Company
learns nothing about a request until the user signs in.

Poppy keeps the API and OAuth, and changes three things around them:

- **No registration.** The agent's `client_id` is an HTTPS URL. The Company
  fetches it to get the agent's name and public keys
  ([§4.1](https://personalagentprotocol.org/docs/1.0/spec#agent-identity)), and
  the agent proves who it is by signing, never with a shared secret. A Company
  can still keep an allowlist; it just doesn't need a sign-up process to have
  one.
- **One discovery document.** The agent learns the issuer, the scopes and
  every interface from one well-known file, so the same agent code works at
  every Company.
- **Every request is attributed.** The Session header names the agent, a
  pseudonymous user ID and the Session, signed for that one request
  ([§5.2](https://personalagentprotocol.org/docs/1.0/spec#the-session-header)).
  A Company can rate-limit per user, keep state per Session and serve signed-out
  traffic it can actually reason about, which a plain API can't.

**Choose a plain API** when the only clients are ones you know and register
yourself. **Add Poppy** when you want any agent your users choose to work, on
your terms.

## Against MCP

MCP standardizes how a client calls tools on a server, and its authorization
builds on OAuth. A Company that already runs an MCP server for its services is
well placed, and Poppy doesn't replace it: an MCP server is one of the
interfaces `poppy.json` lists (`"type": "mcp"`), next to OpenAPI and the
conversation endpoint. The
[Company kit](https://personalagentprotocol.org/kit/company) notes that an MCP
server can stay as it is, taking ordinary OAuth access tokens issued for it;
the [guides](https://personalagentprotocol.org/docs/1.0/guides) cover the
details of running both.

What Poppy adds on top of an MCP server:

- **The Company as a whole, not one server.** Discovery covers the Company's
  API, MCP servers, Company Agent, website and the tasks it won't do, with one
  identity and one sign-in across them.
- **Attribution beyond the token.** With the Session header, a tool call
  belongs to a known agent, user and Session even when signed out. A server
  that ignores the header still works, but its calls belong to no Session.
- **Approvals with exact terms.** Operations returns the terms of a change,
  pins them to a revision and accepts only an approval of that revision, over
  MCP too (through `_meta`). That's a guarantee about what the user agreed to,
  not a confirmation prompt the model can talk past.
- **A person, when needed.** Conversations let the agent ask the Company's own
  agent and hand off to staff, which tools alone don't model.

**Keep MCP** as the way your tools are called. **List it in `poppy.json`** so
agents find it, sign in once and get approvals that hold.

## Against browser automation

Agents that drive a browser (computer use, headless scripts) work at any site
today, which is why they're everywhere. They sign in as the user, often with the
user's password, and click through pages built for people.

For the Company, that traffic is indistinguishable from the user, can do
anything the user can, and breaks when the page changes. For the user, there's
no way to say "read my orders but don't change them", and no record of which
actions were the agent's.

Poppy gives both sides the points in between that browser automation lacks:
signed-out access the Company can identify, scoped access the user grants on
the Company's page, and approvals for changes. It doesn't ban the browser
either: browser join
([§6](https://personalagentprotocol.org/docs/1.0/spec#web-browsing)) lets an
agent's browser join the same Session with a cookie limited to the scopes the
user granted, for the parts that only exist as web pages.

## Against UCP

The Universal Commerce Protocol targets one domain, commerce: checkout,
orders and linking a shopper's identity to a merchant. Poppy is
domain-neutral. Lantern sells noodles, but Harborline is a bank and Northwind
an airline, and the same agent code works at all three.

They can coexist. The guides describe where a deployment that uses both can
reuse an authorization server and operator keys, and where their requirements
differ, so neither protocol's token or signature is assumed to work in the
other.

## What it costs a Company

Less than it sounds, because most of it is what you already run. The
[kit's architecture](https://personalagentprotocol.org/kit/company#architecture)
lists the additions; in our gateway they map to:

| Addition                                   | In Poppy Lab                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `poppy.json` and resource metadata         | Static JSON per Company ([`discovery.ts`](../../packages/pap-company/src/gateway/discovery.ts))                                |
| A token endpoint that verifies agents      | Client assertions checked against the agent's published keys ([`tokens.ts`](../../packages/pap-company/src/gateway/tokens.ts)) |
| Session records                            | One map keyed by client, Session ID and user ([`sessions.ts`](../../packages/pap-company/src/gateway/sessions.ts))             |
| Session header checks in front of the API  | One middleware; business routes don't change                                                                                   |
| Optional: conversations, Operations, tasks | Separate modules, each optional                                                                                                |

A Company that only wants to be found can stop at a `poppy.json` without
`auth`. The rest can come one milestone at a time, and the official validator
checks each one (see [Validator results](validator.md)).
