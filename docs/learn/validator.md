# Validator results

The [Company implementation kit](https://personalagentprotocol.org/kit/company)
ships a validator: a command-line test Personal Agent that runs against a live
deployment. Each check quotes the requirement it tests and, when it fails,
shows what it sent, what came back and what it expected. It's the closest
thing to a conformance test the protocol has, although passing it isn't a
certification.

## Results, 25 November 2026

All four Poppy Lab Companies, with version 1.0 and Operations version 3:

| Company                                            | Pass | Fail | Warn | Skipped |
| -------------------------------------------------- | ---- | ---- | ---- | ------- |
| [Lantern Noodle Bar](https://food-demo.poppylab.dev) | 107  | 0    | 0    | 26      |
| [Juniper Market](https://grocery-demo.poppylab.dev)     | 107  | 0    | 0    | 26      |
| [Harborline Bank](https://bank-demo.poppylab.dev) | 107  | 0    | 0    | 26      |
| [Northwind Air](https://airline-demo.poppylab.dev)    | 107  | 0    | 0    | 26      |

The skipped checks are for parts these Companies don't offer: browser join
(12), MCP (4), several protocol versions (2), Device and Mediated Sign-In (3),
a second domain under the same issuer (2), skills (1) and streaming (1). One
more depends on the report: the validator's own feedback report got a plain
202, so there was no alternative to check. Most of sign-in can't be tested by the
validator at all, because it never signs anyone in; the kit's `checklist.md`
covers that by hand.

## What it found

The first run, before the fixes, had 97 passes, 2 failures and 8 warnings,
the same at every Company because they share one gateway:

1. **Unknown refresh tokens got the wrong error.** The validator tests client
   assertions by sending a good assertion with a refresh token that doesn't
   exist and expecting `invalid_grant`. Our token endpoint checked the DPoP
   proof first and answered `invalid_dpop_proof`, so none of its eight
   assertion checks could tell whether the assertion had been accepted. The
   fix looks the refresh token up before the proof; a real refresh token
   still needs the key it was bound to.
2. **Direct Conversations had the wrong errors.** We don't offer Direct
   Conversations yet and refused every `parent_conversation_id` with
   `invalid_request`. The spec gives a bad parent its own errors,
   `conversation_not_found` and `conversation_closed`
   ([§8.10](https://personalagentprotocol.org/docs/1.0/spec#direct-conversations)),
   and it doesn't make Direct Conversations optional. The parent is now
   checked first; Direct Conversations themselves are our next piece of work.

Neither showed up in our own 470-odd tests or in the community validator,
because both test what we thought the rules were.

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

Things we learned running it:

- **Host the two files byte for byte.** We serve them as static files from
  [`apps/playground/public/validator-agent`](../../apps/playground/public/validator-agent)
  and excluded them from Prettier, which would otherwise reformat them.
- **Give `--probe` a GET that succeeds.** Ours first pointed at an endpoint
  with a required query parameter; its 400 made the validator skip most of
  the Session checks. A URL with the parameter
  (`/api/travel-information?topic=baggage`) fixed it.
- **It talks to your Company Agent.** It sends "Validator test message.
  Please ignore." and closes the conversations it opened. Point it at a test
  environment if a person might read them.
- **`--json` is worth it.** Every result carries the exchanges, with secrets
  redacted, which is the quickest way to see why a check failed.
