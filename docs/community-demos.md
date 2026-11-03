# Ideas from the community demos (3 November 2026)

Reviewed: [personalagentprotocol.org/docs/demos](https://personalagentprotocol.org/docs/demos), Cliffside Retail, Poppy Demo Agent (`adewale/pda`), Print with Poppy (`spenciefy/print-with-poppy`) and Poppy on Cloudflare Workers (`irvinebroque/poppy-demo`). Nothing was signed in to or ordered.

## Evidence

- The PDA validator reports `juniper.poppylab.dev`, `noodles.poppylab.dev` and `https://poppylab.dev/agent/client.json` **valid with 0 errors, 0 warnings and 0 info** (after adding `Cache-Control` to the OAuth/resource metadata, client metadata and JWKS).
- PAP Sandbox stores publish `protocol_version: "0.3"` with Operations v1, but their APIs still ask for the 0.2 Session Token (`Authorization: DPoP <token>`, "4.3"). They stay incompatible; Poppy now explains a refused signed-out Session instead of asking to sign in again.

## Done

1. **Protocol demo without a key** in the public playground (keyword rules call the Company's tools; proposals still need approval).
2. **`Cache-Control`** on metadata.
3. **Inspector:** a spec section on every discovery and API step, **Copy trace for an interop report** (no secrets), and a link to the independent validator (sends only the domain).
4. **Spec pin and drift check** (`pnpm spec:drift`). It found the `poppy_dlg` change immediately; see `pap-03.md`.

## Playground against the other demos (3 November 2026, production, signed out, Protocol demo)

| Company                                 | Result                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Juniper Market, Lantern Noodle Bar      | Discovery, Session (`poppy_dlg`) and API reads work.                                                                                                                                                                                                                                                                                                                                                  |
| Cliffside Retail                        | Discovery works. It still follows the earlier 0.3 text: it accepts only `pap_dlg` with `pap-delegation+jwt` (confirmed with a temporary probe agent, since deleted). Poppy now falls back to that form once after a repeated `invalid_session` and remembers it: `whoami` answers "You are Poppy Lab … signed out"; `rewards` asks for sign-in. Sign-in isn't offered (not in `PAP_ACCOUNT_ORIGINS`). |
| Print with Poppy sandbox                | Discovery works (Device and Mediated Sign-In only). `400 invalid_session`: the sandbox accepts registered agents only (register by email).                                                                                                                                                                                                                                                            |
| Poppy on Cloudflare Workers (Northstar) | Refused at discovery: draft 0.1.                                                                                                                                                                                                                                                                                                                                                                      |
| PAP Sandbox                             | `poppy.json` says 0.3, the API still wants the 0.2 Session Token.                                                                                                                                                                                                                                                                                                                                     |

Fixes from this round: the Protocol demo picks a tool that needs no arguments (or the one named in the message) instead of guessing arguments; protocol errors show the Company's status and code; signed-out sign-in challenges and refused Sessions get accurate messages; Juniper and Lantern accept both 0.3 delegation forms.

## Next

- Inspector for external agents at Juniper and Lantern (Cliffside's private link obtained with a client assertion).
- Mediated and Device Sign-In (Cliffside, Print with Poppy).
- Company conversations (§8), with handoff and Direct conversations.
- A strict Juniper mode that records an agent's violations; later an adversarial Company.
- Interop runs with PDA (its `client_id` is already accepted), Cliffside and the Print with Poppy sandbox (needs registration).
- Listing on the community demos page (the user's decision).
