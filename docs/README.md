# Documentation

Three kinds of document live here.

## Learn: for anyone

Practical pages about Personal Agent Protocol ("Poppy"), also published at
[poppylab.dev/learn](https://poppylab.dev/learn). Start here if you want to
understand the protocol or implement it.

- [Overview](learn/README.md)
- [One task, request by request](learn/one-task.md)
- [Poppy compared](learn/compared.md)
- [Conversations with a Company Agent](learn/conversations.md)
- [Approvals with Operations](learn/operations.md)
- [Build a Company](learn/build-a-company.md)
- [Build a Personal Agent](learn/build-an-agent.md)
- [Pitfalls and interop](learn/pitfalls.md)
- [Validator results](learn/validator.md)
- [Glossary](learn/glossary.md)

## Design notes: for contributors

How Poppy Lab itself is built and what it covers. These describe the current
code and change with it.

| Note                                                                                                                                                                                     | Covers                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [Poppy 1.0](poppy-1.0.md)                                                                                                                                                                | What changed in the move to 1.0 and Operations v3, section by section, and what's missing  |
| [Coverage](coverage.md)                                                                                                                                                                  | Every capability, on each side, with its evidence                                          |
| [Portable runtime](portable-runtime.md)                                                                                                                                                  | Running the same code on Cloudflare Workers and Node; deployment and secrets               |
| [Conversations](conversations.md)                                                                                                                                                        | The deterministic Company Agents and Iris's conversation tools                             |
| [Community demos](community-demos.md)                                                                                                                                                    | Results against other implementations and validators                                       |
| [Scenario lab](scenario-lab.md)                                                                                                                                                          | Isolated scenario suites, nonces and revisions                                             |
| [Lantern](lantern-noodles.md), [Harborline](harborline-bank.md), [Northwind](northwind-air.md)                                                                                           | The three standalone Companies                                                             |
| [Product photos](product-photos.md)                                                                                                                                                      | The generated photos on Juniper and Lantern: files, serving, catalogue field, regenerating |
| [Juniper website](juniper-web.md), [services](juniper-services.md), [profiles](juniper-profile.md), [shopping](juniper-shopping-web.md), [personas](juniper-personas.md)                 | The grocery Company, its customer website and its services                                 |
| [Chat workspace](chat-workspace.md), [chat continuity](chat-continuity.md), [permissions and recovery](permission-consent.md), [OpenAPI tools](openapi-tools.md), [MCP](mcp-readonly.md) | Iris's interface and how it uses each kind of interface                                    |

## History: for the record

[`history/`](history) keeps notes written for earlier drafts of the protocol
(0.1 to 0.3) and for features the lab has since removed, such as the PAP
Sandbox integration and the identity relay. They explain past decisions; don't
use them as a description of current behaviour.
