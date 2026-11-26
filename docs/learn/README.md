# Learn Personal Agent Protocol

Learn teaches Personal Agent Protocol ("Poppy"), the open protocol that lets a
person's agent work with a company's own website and services, while the
company decides what the agent may do. [Poppy Lab](https://poppylab.dev) is the
working example: a personal agent, Iris, and fictional companies running the
protocol.

Business readers start at [How it works](how-it-works/README.md). Implementers
start at [One task, request by request](one-task.md), then the Build guides.

![You ask your agent. Your agent sends signed requests to the company, and the company holds any change for approval. You sign in on the company's own page, not through the agent, and you approve the exact change in your agent. Those two things, signing in and approving, are the ones only you do.](../../apps/playground/public/learn-media/diagrams/who-talks-to-whom.svg "You ask your agent, your agent sends signed requests to the company, and only you sign in and approve.")

Read Learn next to the official material:

- the [specification](https://personalagentprotocol.org/docs/1.0/spec) and the
  [Operations extension](https://personalagentprotocol.org/docs/1.0/extensions/operations),
  which define the protocol;
- the [guides](https://personalagentprotocol.org/docs/1.0/guides), which advise
  topic by topic;
- the [Company implementation kit](https://personalagentprotocol.org/kit/company),
  a skill and validator for the company's side.

## Follow a process

| Page                                        | Covers                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| [How it works](how-it-works/README.md)      | Everyday processes, one screen at a time: who does what, and who decides.               |
| [One task, request by request](one-task.md) | A noodle-order change, first fetch to approval, every request and response written out. |

## Understand

| Page                                                   | Covers                                                                                                                                              |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Poppy compared](compared.md)                          | Poppy beside an API with OAuth, MCP, browser automation and UCP.                                                                                    |
| [Conversations with a Company Agent](conversations.md) | A refund, agent to agent: structured data, mid-conversation sign-in, proposals, approval, asking for a person.                                      |
| [Approvals with Operations](operations.md)             | The life of an operation: terms, who approves, how approvals travel, declines, at-most-once retries.                                                |
| [Domain extensions](extensions/README.md)              | How a domain's own standard rides on a Poppy extension, with [FDX for bank data](extensions/fdx.md) and [ESPI for energy data](extensions/espi.md). |

## Build

| Page                                              | Covers                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [Build a Company](build-a-company.md)             | The kit's milestones, from one static file to sign-in and approvals, with code to adapt.               |
| [Build a Personal Agent](build-an-agent.md)       | What the kit doesn't cover: identity, sessions, safe fetching, sign-in, approvals, the model's limits. |
| [Write a domain extension](write-an-extension.md) | Define an extension for a domain you control and list it under `extensions` in `poppy.json`.           |

## Look up

| Page                              | Covers                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------- |
| [Validator results](validator.md) | What the official validator checks, and how it ran against the lab's companies. |
| [Glossary](glossary.md)           | The protocol's words in plain language, each linked to where it is explained.   |

Everything here covers version 1.0 with Operations version 3. Examples come from
the lab's fictional companies; no real account, money, food or flight is
involved. Poppy Lab is independent and not affiliated with the protocol's
authors; "Personal Agent Protocol" and "Poppy" are their names.
[Writing Learn pages](WRITING.md) holds the rules these pages follow.
