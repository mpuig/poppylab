# Validator results

The [Company implementation kit](https://personalagentprotocol.org/kit/company)
ships a validator: a command-line test Personal Agent that runs against a live
deployment. Each check quotes the requirement it tests and, on failure, shows
what it sent, what came back and what it expected. It is the protocol's nearest
thing to a conformance test; passing it is not a certification.

This page lists Poppy Lab's results and notes for running the validator, not the
checks. [Build a Company](build-a-company.md) says at which
milestones to run it.

## Results, 26 November 2026

Five Companies (version 1.0, Operations version 3) ran against the kit
published on 25 November 2026.
Harborline and Fernwick have no signed-out `GET` for `--probe`, so they ran
without one:

| Company                                                    | Pass | Fail | Warn | Skipped |
| ---------------------------------------------------------- | ---- | ---- | ---- | ------- |
| [Lantern Noodle Bar](https://food-demo.poppylab.dev)       | 120  | 0    | 0    | 13      |
| [Juniper Market](https://grocery-demo.poppylab.dev)        | 121  | 0    | 0    | 12      |
| [Harborline Bank](https://bank-demo.poppylab.dev)          | 120  | 0    | 0    | 13      |
| [Northwind Air](https://airline-demo.poppylab.dev)         | 120  | 0    | 0    | 13      |
| [Fernwick Power & Light](https://energy-demo.poppylab.dev) | 120  | 0    | 0    | 13      |

Skipped checks cover parts these Companies lack: MCP (4), several protocol
versions (2), Device and Mediated Sign-In (3), a second domain under the same
issuer (2) and streaming (1). One more depends
on the report. Juniper answers the validator's feedback report with an
alternative, opening a support case through its API, and that alternative is
checked. The other four answer a plain `202`, so no alternative is checked
there.

The validator never signs anyone in; the kit's `checklist.md` covers most of
sign-in by hand. Its extension checks see only a run declaring no extensions,
so say nothing about `poppylab.dev/fdx` at Harborline or
`poppylab.dev/espi` at Fernwick.

## Running it yourself

You need Node 22.18 or later and a host for two public files over HTTPS.

```sh
curl -LO https://personalagentprotocol.org/kit/implement-personal-agent-protocol.zip
unzip implement-personal-agent-protocol.zip
V=implement-personal-agent-protocol/validate/index.ts

# A test Personal Agent. The private key stays in .poppy/; never host it.
node $V keygen --base-url https://example.com/validator-agent
# Host .poppy/agent.json and .poppy/jwks.json, unchanged, at that base URL.

# Run it. --probe names a signed-out GET in your API, with its parameters.
node $V check https://company.example --probe "https://company.example/api/menu"
```

How the lab runs it:

- **The two hosted files.** The validator needs `agent.json` and `jwks.json`
  served byte for byte. The lab serves them as static files from
  [`apps/playground/public/validator-agent`](../../apps/playground/public/validator-agent),
  excluded from Prettier, which would reformat them.
- **`--probe`.** A signed-out `GET` that succeeds, with any required query
  parameter, such as `/api/travel-information?topic=baggage`. A probe that
  answers `400` for a missing parameter makes the validator skip most Session
  checks.
- **The Company Agent.** Each run opens two test conversations with the Company
  Agent, sends "Validator test message. Please ignore." and closes both. A person
  reading its conversations sees these.
- **`--json`.** Every result carries the exchanges, secrets redacted, which show
  why a check failed.
