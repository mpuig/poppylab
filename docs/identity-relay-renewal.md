# Identity relay renewal (20 October 2026)

> **Historical.** The relay exposed a local Poppy's public identity while the playground ran only locally. Poppy now runs publicly at `poppylab.dev` with its own HTTPS identity, so the relay is no longer used.

The operator authorized renewing the tunnel after checking that its previous hostname no longer resolved. Only the old relay and tunnel processes, whose identity and PIDs were verified as ours, were stopped; Poppy and Juniper were left running.

## Changes

- A new Cloudflare quick tunnel pointed only at `127.0.0.1:4101`.
- The relay was restarted with the callback allowed for the exact issuer `https://api.ample.computer/poppy`, as well as the three existing Sandbox issuers. The origin without `/poppy`, other paths and look-alike domains are rejected.
- Only `AGENT_PUBLIC_ORIGIN` was updated in the ignored `.env.local`. A fingerprint of the rest of the file confirmed that models, keys and other values didn't change. Next picked up the change without restarting.
- The signing key didn't change: the public JWKS before and after was identical.
- The temporary supervisor read cloudflared's output and kept only the assigned public URL and exit status, not request URLs or callback values.

The process and log files lived under `/tmp` for that session. The tunnel was temporary, not a production deployment.

## Real public checks

All over HTTPS with certificate validation; TLS was never disabled:

| Public request                                | Result                                                 |
| --------------------------------------------- | ------------------------------------------------------ |
| GET `/agent/client.json`                      | 200; client_id, JWKS and callback match the new origin |
| GET `/agent/jwks.json`                        | 200; same public key, no `d`                           |
| GET `/`, `/api/chat`, `/api/account`          | 404                                                    |
| GET `/.env.local`, `/.poppy/identity.json`    | 404                                                    |
| GET metadata with proxy parameters            | 404                                                    |
| POST `/agent/client.json`                     | 405                                                    |
| Ample callback with synthetic state and code  | 302 to the fixed localhost; not followed               |
| Callback from Ample's origin without `/poppy` | 400                                                    |

The synthetic callback didn't correspond to any consent and wasn't exchanged for tokens. No tools or Ample accounts were called.

The first check with Python's urllib failed because of the local Python certificate store; it was completed with curl and its normal TLS verification, without `-k` or equivalent.

## What to do next (at the time)

1. Reload `http://localhost:3000`.
2. Enter `https://ample.computer` and choose **Connect** again, even if it already shows as connected: a new run with the new identity is needed.
3. Choose **Sign in to Ample Computer · read only** and complete the consent at Ample yourself.
4. Return to Poppy and ask for a read. Keep the relay and tunnel running.

The origin change changes the `client_id`. Grants stored under the previous identity weren't changed, revoked or migrated. Since the old URL no longer resolved, revoking them may need to happen at the Company; they weren't reused under the new identity.

The relay's 10 tests cover the public surface, rejected private keys, the Sandbox and Ample callbacks, the fixed redirect and wrong issuers. Full suite at the time: 322 tests. None of these replace human authorization or show successful private reads at Ample.
