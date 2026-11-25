# Learn Personal Agent Protocol

Learn teaches Personal Agent Protocol ("Poppy"), the open protocol that lets a
person's agent work with a company's own website and services, while the
company decides what the agent may do. [Poppy Lab](https://poppylab.dev) is the
working example: one personal agent, Iris, and fictional companies that run the
protocol. Each process on these pages is one that runs in the lab.

Business readers start at [How it works](how-it-works/README.md), which shows
everyday processes one screen at a time. Implementers start at
[One task, request by request](one-task.md) and go on to the Build guides.

Learn links to the official material instead of repeating it. Read it next to:

- the [specification](https://personalagentprotocol.org/docs/1.0/spec) and the
  [Operations extension](https://personalagentprotocol.org/docs/1.0/extensions/operations),
  which define the protocol;
- the [guides](https://personalagentprotocol.org/docs/1.0/guides), which give
  advice topic by topic;
- the [Company implementation kit](https://personalagentprotocol.org/kit/company),
  a skill for coding agents plus a validator, for the company's side.

## Follow a process

Each page follows one task from the first request to the result.

| Page                                        | What it gives you                                                                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [How it works](how-it-works/README.md)      | Everyday processes shown one screen at a time, on the agent's side and on the company's website: who does what, and who decides. |
| [One task, request by request](one-task.md) | A change to a noodle order, from the first fetch to the approved change, with each request and response written out.             |

## Understand

Each page answers one question about why the protocol is built the way it is.

| Page                                                   | What it gives you                                                                                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Poppy compared](compared.md)                          | Poppy next to an API with OAuth, MCP, browser automation and UCP, and what each one gives a company and a user.                                                          |
| [Conversations with a Company Agent](conversations.md) | A refund handled from agent to agent: structured data, sign-in in the middle of a conversation, a proposal in a message, the approval, and asking for a person.          |
| [Approvals with Operations](operations.md)             | The life of an operation: terms and revisions, who may approve, how approvals travel through each interface, declines and at-most-once retries.                          |
| [Domain extensions](extensions/README.md)              | How a domain's own standard rides on a Poppy extension, with two worked examples: [FDX for bank data](extensions/fdx.md) and [ESPI for energy data](extensions/espi.md). |

## Build

Each page gives the steps to one goal.

| Page                                              | What it gives you                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [Build a Company](build-a-company.md)             | The kit's milestones, from one static file to sign-in and approvals, with code to adapt and the lab's gateway as a reference.        |
| [Build a Personal Agent](build-an-agent.md)       | The side the official kit doesn't cover: identity, users and sessions, safe fetching, sign-in, approvals, and where the model stops. |
| [Write a domain extension](write-an-extension.md) | The steps to define an extension for a domain you control and list it under `extensions` in `poppy.json`.                            |

## Look up

Each page lists facts, in the same pattern every time.

| Page                              | What it gives you                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| [Validator results](validator.md) | What the official validator checks, how it ran against the lab's companies, and what it reported. |
| [Glossary](glossary.md)           | The protocol's words in plain language, each linked to where it is explained.                     |

Everything here is about version 1.0 with Operations version 3. The examples
come from the lab's fictional companies; no real account, money, food or flight
is involved. Poppy Lab is independent and not affiliated with the protocol's
authors; "Personal Agent Protocol" and "Poppy" are their names. The rules these
pages are written by are in [Writing Learn pages](WRITING.md).
