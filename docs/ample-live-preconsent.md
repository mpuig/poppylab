# Ample: live test up to human authorization

> **Historical.** Ample publishes PAP 0.1 and the integration was removed when Poppy moved to 0.3 only.

The flow was tested in an isolated agent-browser session, with no fixtures and no cookies from existing accounts.

## Observed live

1. The relay's public metadata answered HTTP 200 over HTTPS.
2. Connect discovered `https://ample.computer` as Ample Computer, PAP 0.1, MCP channel.
3. GPT-6 Luna (low) was sent: "List my Ample servers. Read only, make no changes." The model replied that Sign in was needed; it didn't claim to have listed servers or made changes.
4. On Sign in, Poppy got a valid pre-consent Session response from Ample and opened its real `/poppy/authorize` endpoint.
5. Ample's page showed an empty Email field and Continue. The requested scopes `servers:read budgets:read`, PKCE S256 and the presence of state were checked, without logging their values or the challenge. The client and callback used the relay's new public origin.
6. Poppy's chat kept the conversation and showed that it was waiting for sign-in to finish at the Company.

## Limit of this test

It stopped before entering an email or continuing at Ample. **No account was authenticated, no consent was approved, no Account Token was received and no private infrastructure tool was called.** The pre-consent Session was created live; that isn't account access.

The isolated browser session was closed after checking the form, and its pending state must not be reused. The callback, the signed account exchange, private listing and real revocation remained covered only by isolated tests, not by this observation.

A screenshot of the form without credentials was taken locally and isn't included in the repository. It showed the empty Email form and Continue, and no state, codes or credentials. No HAR was saved and no authorization URLs with transient parameters were printed.

The restricted relay and tunnel were left running. No keys, configuration, existing grants or infrastructure data were changed during this test.
