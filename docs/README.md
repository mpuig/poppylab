# Documentation

Three kinds of document live here.

## Learn: for anyone

Practical pages about Personal Agent Protocol ("Poppy"), also published at
[poppylab.dev/learn](https://poppylab.dev/learn). Start here if you want to
understand the protocol or implement it.

- **Overview:** [Learn Personal Agent Protocol](learn/README.md)
- **Follow a process:** [How it works](learn/how-it-works/README.md) (11 screen-by-screen walkthroughs) · [One task, request by request](learn/one-task.md)
- **Understand:** [Poppy compared](learn/compared.md) · [Conversations with a Company Agent](learn/conversations.md) · [Approvals with Operations](learn/operations.md) · [Domain extensions](learn/extensions/README.md) ([FDX](learn/extensions/fdx.md), [ESPI](learn/extensions/espi.md))
- **Build:** [Build a Company](learn/build-a-company.md) · [Build a Personal Agent](learn/build-an-agent.md) · [Write a domain extension](learn/write-an-extension.md)
- **Look up:** [Validator results](learn/validator.md) · [Glossary](learn/glossary.md)

## Design notes: for contributors

How Poppy Lab itself is built and what it covers. These describe the current
code and change with it.

| Note                                                                                                                                                                                     | Covers                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [Poppy 1.0](poppy-1.0.md)                                                                                                                                                                | What changed in the move to 1.0 and Operations v3, section by section, and what's missing                                                      |
| [Coverage](coverage.md)                                                                                                                                                                  | Every capability, on each side, with its evidence                                                                                              |
| [Portable runtime](portable-runtime.md)                                                                                                                                                  | Running the same code on Cloudflare Workers and Node; deployment, secrets and the hourly production checks                                     |
| [Conversations](conversations.md)                                                                                                                                                        | The deterministic Company Agents and Iris's conversation tools                                                                                 |
| [Community demos](community-demos.md)                                                                                                                                                    | Results against other implementations and validators                                                                                           |
| [Model phrases](model-phrases.md)                                                                                                                                                        | About fifteen real phrases asked of a real model by hand before a promotion, and what each answer is checked for                               |
| [Scenario lab](scenario-lab.md)                                                                                                                                                          | Isolated scenario suites, nonces and revisions                                                                                                 |
| [Lantern](lantern-noodles.md), [Harborline](harborline-bank.md), [Northwind](northwind-air.md), [Fernwick](fernwick-power.md)                                                            | The four standalone Companies (noodle bar, bank, airline and electricity utility)                                                              |
| Extensions: [`poppylab.dev/fdx`](extensions/fdx.md), [`poppylab.dev/espi`](extensions/espi.md)                                                                                           | The lab's experimental domain extensions, FDX-shaped (bank data) and ESPI-shaped (energy usage): discovery, scopes, consent, resources, errors |
| [Product photos](product-photos.md)                                                                                                                                                      | The generated photos on Juniper and Lantern: files, serving, catalogue field, regenerating                                                     |
| [Juniper website](juniper-web.md), [services](juniper-services.md), [profiles](juniper-profile.md), [shopping](juniper-shopping-web.md), [personas](juniper-personas.md)                 | The grocery Company, its customer website and its services                                                                                     |
| [The agent's core](pap-agent.md)                                                                                                                                                         | The Personal Agent as a package: its API, storage and identity interfaces, how a channel plugs in                                              |
| [Chat workspace](chat-workspace.md), [chat continuity](chat-continuity.md), [permissions and recovery](permission-consent.md), [OpenAPI tools](openapi-tools.md), [MCP](mcp-readonly.md) | Iris's interface and how it uses each kind of interface                                                                                        |
| [MCP at the Companies](mcp-company.md)                                                                                                                                                   | The MCP server the gateway runs at every Company: its tools, tokens and checks                                                                 |
