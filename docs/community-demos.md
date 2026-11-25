# Community demos

## 1.0 round (25 November 2026)

The [demos page](https://personalagentprotocol.org/docs/demos) now lists Cliffside Retail (1.0), Poppy Demo Agent (0.4) and Print with Poppy (0.4). PAP Sandbox and Northstar are no longer listed. Iris implements 1.0 only. Nothing was signed in to or ordered.

| Demo             | Result with Iris on `poppylab.dev`                                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cliffside Retail | **Works signed out.** Discovery passes every check. `whoami` sees Iris, its User ID and a signed-out Session, with the standard `poppy_dlg` form (the 0.3 fallback is gone). Cliffside's Company agent answers a 1.0 conversation (request IDs, four state fields). Iris sends no `Poppy-Extensions`: Cliffside lists none. Sign-in needs Mediated Sign-In, which Iris doesn't implement. |
| Poppy Demo Agent | Its validator checks against 1.0: `juniper.poppylab.dev`, `noodles.poppylab.dev` and `poppylab.dev/agent/client.json` are **valid with 0 errors, 0 warnings and 0 info**.                                                                                                                                                                                                                 |
| Print with Poppy | Still on 0.4, which a 1.0-only Iris refuses; its sandbox also accepts registered agents only.                                                                                                                                                                                                                                                                                             |

**Found and fixed:** Cliffside's 1.0 OpenAPI contract declares `Poppy-Version` on every operation as a header parameter, by reference to `#/components/parameters`. Iris's tool generator refused `$ref` parameters, so it skipped every operation. It now resolves local parameter references and leaves the protocol headers it sets itself out of the model's arguments.

## Next

- Direct Conversations (§8.10), which the official validator expects; then run it again.
- Mediated and Device Sign-In, so Iris can sign in at Cliffside and Print with Poppy.
- Signed-in interop runs with the Poppy Demo Agent (its `client_id` is accepted by our Companies) and Cliffside.
- The official validator's results are in [validator results](learn/validator.md); the community validator's are above.

## Earlier rounds (0.3, historical)

These describe implementations, ours included, as they were on 3 November 2026, under draft 0.3. Several have moved on since.

### 0.3 round (3 November 2026)

Reviewed: [personalagentprotocol.org/docs/demos](https://personalagentprotocol.org/docs/demos), Cliffside Retail, Poppy Demo Agent (`adewale/pda`), Print with Poppy (`spenciefy/print-with-poppy`) and Poppy on Cloudflare Workers (`irvinebroque/poppy-demo`). Nothing was signed in to or ordered.

### Evidence

- The PDA validator reports `juniper.poppylab.dev`, `noodles.poppylab.dev` and `https://poppylab.dev/agent/client.json` **valid with 0 errors, 0 warnings and 0 info** (after adding `Cache-Control` to the OAuth/resource metadata, client metadata and JWKS).
- PAP Sandbox stores publish `protocol_version: "0.3"` with Operations v1, but their APIs still ask for the 0.2 Session Token (`Authorization: DPoP <token>`, "4.3"). They stay incompatible; Poppy now explains a refused signed-out Session instead of asking to sign in again.

### Done

1. **Protocol demo without a key** in the public playground (keyword rules call the Company's tools; proposals still need approval).
2. **`Cache-Control`** on metadata.
3. **Inspector:** a spec section on every discovery and API step, **Copy trace for an interop report** (no secrets), and a link to the independent validator (sends only the domain).
4. **Spec pin and drift check** (`pnpm spec:drift`). It found the `poppy_dlg` change immediately.

### Playground against the other demos (3 November 2026, production, signed out, Protocol demo)

| Company                                 | Result                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Juniper Market, Lantern Noodle Bar      | Discovery, Session (`poppy_dlg`) and API reads work.                                                                                                                                                                                                                                                                                                                                                  |
| Cliffside Retail                        | Discovery works. It still follows the earlier 0.3 text: it accepts only `pap_dlg` with `pap-delegation+jwt` (confirmed with a temporary probe agent, since deleted). Poppy now falls back to that form once after a repeated `invalid_session` and remembers it: `whoami` answers "You are Poppy Lab … signed out"; `rewards` asks for sign-in. Sign-in isn't offered (not in `PAP_ACCOUNT_ORIGINS`). |
| Print with Poppy sandbox                | Discovery works (Device and Mediated Sign-In only). `400 invalid_session`: the sandbox accepts registered agents only (register by email).                                                                                                                                                                                                                                                            |
| Poppy on Cloudflare Workers (Northstar) | Refused at discovery: draft 0.1.                                                                                                                                                                                                                                                                                                                                                                      |
| PAP Sandbox                             | `poppy.json` says 0.3, the API still wants the 0.2 Session Token.                                                                                                                                                                                                                                                                                                                                     |

Fixes from this round: the Protocol demo picks a tool that needs no arguments (or the one named in the message) instead of guessing arguments; protocol errors show the Company's status and code; signed-out sign-in challenges and refused Sessions get accurate messages; Juniper and Lantern accept both 0.3 delegation forms.
