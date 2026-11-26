# Validator results

The [Company implementation kit](https://personalagentprotocol.org/kit/company)
ships a validator: a command-line test Personal Agent that runs against a live
deployment. Each check quotes the requirement it tests and, when it fails,
shows what it sent, what came back and what it expected. It is the closest
equivalent to a conformance test that the protocol has; passing it is not a
certification.

This page lists the results for Poppy Lab's Companies and the notes for running
the validator. It does not list the checks one by one, because each check
quotes its own requirement. For the milestones at which the validator is used,
see [Build a Company](build-a-company.md).

## Results, 26 November 2026

Five Poppy Lab Companies, with version 1.0 and Operations version 3, ran at
their current hostnames, with the kit as published on 25 November 2026.
Harborline and Fernwick have no signed-out `GET` to give `--probe`, so they ran
without one:

| Company                                                    | Pass | Fail | Warn | Skipped |
| ---------------------------------------------------------- | ---- | ---- | ---- | ------- |
| [Lantern Noodle Bar](https://food-demo.poppylab.dev)       | 107  | 0    | 0    | 26      |
| [Juniper Market](https://grocery-demo.poppylab.dev)        | 107  | 0    | 0    | 26      |
| [Harborline Bank](https://bank-demo.poppylab.dev)          | 107  | 0    | 0    | 26      |
| [Northwind Air](https://airline-demo.poppylab.dev)         | 107  | 0    | 0    | 26      |
| [Fernwick Power & Light](https://energy-demo.poppylab.dev) | 107  | 0    | 0    | 26      |

The skipped checks are for parts these Companies don't offer: browser join
(12), MCP (4), several protocol versions (2), Device and Mediated Sign-In (3),
a second domain under the same issuer (2), skills (1) and streaming (1). One
more depends on the report: the validator's own feedback report got a plain
`202`, so there was no alternative to check.

The validator never signs anyone in, so it can't test most of sign-in. The
kit's `checklist.md` covers that by hand. Its extension checks see only a run
that declares no extensions, so they say nothing about `poppylab.dev/fdx` at
Harborline or `poppylab.dev/espi` at Fernwick. Each run started two test
conversations and closed both.

## Running it yourself

You need Node 22.18 or later and somewhere to host two public files over
HTTPS.

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
  [`apps/playground/public/validator-agent`](../../apps/playground/public/validator-agent)
  and excludes them from Prettier, which would otherwise reformat them.
- **`--probe`.** It takes a signed-out `GET` that succeeds, with any required
  query parameter, such as `/api/travel-information?topic=baggage`. A probe
  that answers `400` for a missing parameter makes the validator skip most of
  the Session checks.
- **The Company Agent.** The validator sends "Validator test message. Please
  ignore." to the Company Agent and closes the conversations it opened. If a
  person reads the Company Agent's conversations, they see these.
- **`--json`.** Every result carries the exchanges, with secrets redacted, which
  shows why a check failed.
