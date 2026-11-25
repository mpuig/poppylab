# Learn Poppy by running it

Practical notes on Personal Agent Protocol ("Poppy"), written while building
[Poppy Lab](https://poppylab.dev): one Personal Agent (Iris) and four fictional
Companies that pass the official validator.

The official site already has the normative text and the advice. This section
links to them rather than repeating them. Use it next to:

- the [specification](https://personalagentprotocol.org/docs/1.0/spec) and the
  [Operations extension](https://personalagentprotocol.org/docs/1.0/extensions),
  which define the protocol;
- the [guides](https://personalagentprotocol.org/docs/1.0/guides), which give
  advice topic by topic;
- the [Company implementation kit](https://personalagentprotocol.org/kit/company),
  a skill for coding agents plus a validator, for the Company side.

What's here instead is what we wished we'd had on day one: real traffic,
comparisons, working code and the mistakes we made.

| Page                                                        | For                                                                                                                                                                                          |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [One task, request by request](one-task.md)                 | Anyone. A change to a noodle order, from the first fetch to the approved change, with the real requests and responses.                                                                       |
| [Poppy compared](compared.md)                               | Deciding whether you need it. Poppy next to an API with OAuth, MCP, browser automation and UCP: what each one gives a Company and a user.                                                    |
| [Conversations with a Company Agent](conversations.md)      | Both sides. A refund handled agent to agent: structured data, sign-in mid-conversation, a proposal in a message, the approval, and asking for a person.                                      |
| [Approvals with Operations](operations.md)                  | Both sides. The life of an operation: terms and revisions, who may approve, how approvals travel through each interface, declines and at-most-once retries.                                  |
| [Domain extensions: bank data through Poppy](extensions.md) | Both sides. A domain standard carried by a Poppy extension, using our FDX-shaped bank: why an extension, the traffic step by step, errors, documents, revocation, and how to write your own. |
| [Build a Company](build-a-company.md)                       | Company implementers. The kit's milestones explained: from one static file to sign-in and approvals, with code to adapt and our gateway as a reference.                                      |
| [Build a Personal Agent](build-an-agent.md)                 | Agent builders. The side the official kit doesn't cover: identity, users and Sessions, safe fetching, sign-in, approvals, and where the model stops.                                         |
| [Pitfalls and interop](pitfalls.md)                         | Both sides. Bugs we shipped and traps we designed around, each with what we saw, why and the fix, plus what we learned testing against other implementations.                                |
| [Validator results](validator.md)                           | Implementers. What the official validator checks, how we ran it against our Companies, and what it found.                                                                                    |
| [Glossary](glossary.md)                                     | Anyone. The protocol's words in plain language, each linked to where it's explained.                                                                                                         |

Everything here is about version 1.0 with Operations version 3. The examples
come from the lab's fictional Companies; no real account, money or food is
involved. Poppy Lab is independent and not affiliated with the protocol's
authors; "Personal Agent Protocol" and "Poppy" are their names.
