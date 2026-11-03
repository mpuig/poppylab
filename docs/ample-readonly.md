# Ample Computer: read-only MCP consent

> **Historical.** Ample publishes PAP 0.1, and Poppy now implements 0.3 only, so this integration was removed. The notes are kept as a record of the read-only MCP design.

Poppy supported Direct Sign-In for the two exact origins `https://ample.computer` and `https://api.ample.computer`, bound exclusively to the issuer `https://api.ample.computer/poppy` and to Ample's verified public endpoints. This didn't widen Operations support or allow other infrastructure Companies.

## Permissions and tools

The consent asked for **`servers:read budgets:read`**, never `servers:write`, `servers:exec`, storage wildcards or credential permissions. A grant that added write access was rejected before replacing the previous access. The UI explained that Ample is a real account, not one of Juniper's fictional personas.

The observed public catalogue allowed verifying these six tools declared as read-only:

| Tool                  | Scope required locally               |
| --------------------- | ------------------------------------ |
| `ample_server_list`   | `servers:read`                       |
| `ample_server_get`    | `servers:read`                       |
| `ample_app_list`      | `servers:read`                       |
| `ample_app_get`       | `servers:read`                       |
| `ample_budget_status` | `budgets:read`                       |
| `ample_usage_current` | `budgets:read` (conservative choice) |

The list was built into the code and couldn't be widened with `PAP_MCP_READ_TOOLS`. Each tool also had to keep advertising `readOnlyHint: true` and a supported schema. Logs, commands, deployments, deletions, tokens, credentials, workspaces and Ample's embedded UI weren't exposed.

Poppy generated `execution_key` in code, outside the model (a random identifier per call), and hid `execution_key` and `workspace_id` from the schema available to the LLM. Injecting them manually was rejected. Normal arguments, such as the server ID, were still validated.

Verifying the public contract **doesn't prove** that a remote server can't lie about the effects of its tools. The local allowlist and scopes limit authority; they aren't an infrastructure sandbox.

## Flow

1. Connect `https://ample.computer` in Poppy.
2. Choose **Sign in to Ample Computer · read only** in the chat. It's a human action; the model can only explain that access is needed.
3. Complete the consent at Ample. Poppy doesn't collect its credentials.
4. Return to Poppy and ask to list apps or servers, or to check the budget or usage. The earlier message isn't replayed, and no model call is made without a new message.
5. If Ample grants only one of the scopes, the tools without permission stay blocked. **Request remaining read access** opens a new consent, also read-only.
6. **Sign out** revokes the active Account Token and removes the cached Session credentials after a successful response. Empty HTTP 200/204 OAuth revocation responses are accepted only for that request. An uncertain failure doesn't delete the local access or trigger automatic retries.

The conversation from before the first account access is kept. Private turns and earlier proposals don't cross another consent, because it may select a different account.

## Tokens and renewal

The consent used a new candidate Session, PKCE S256, state and issuer validation. Preparing it didn't initialize MCP or call remote tools. An invalid grant left the previous access intact.

The general DPoP token and the MCP token were different. For MCP, the resource metadata was validated, `resource=https://api.ample.computer/mcp` requested, and the token renewed using the Account Token and its current scopes. Ample's public metadata didn't advertise DPoP for MCP, so that connection used Bearer; the general token was never sent to MCP. The rotated Account Token was stored only after validating its type, Session, lifetime and scope subset. General renewal still used DPoP and didn't widen scopes.

Each new chat connection obtained a resource token; there was no durable MCP Session cache or resumption. A resource token expiring during a connection failed with guidance to reconnect. Only explicit nonce challenges could be repeated once; uncertain responses weren't retried. Explicit access-not-accepted errors marked the account as unavailable.

## Public identity: renewed relay

Ample needed to verify Poppy's metadata and JWKS over public HTTPS. The relay was to expose only the public identity and a fixed callback; **never the playground**.

After checking that the earlier URL no longer resolved, the operator authorized renewing the relay. The new HTTPS identity answered with public metadata and JWKS, kept the same signing key, and allowed Ample's exact issuer for the callback. The playground stayed blocked. Only `AGENT_PUBLIC_ORIGIN` changed; the rest of the environment was verified identical through a fingerprint without logging its values. The temporary URL lived in the ignored `.env.local`, not in shared configuration.

The origin change changes the `client_id`. Earlier grants aren't migrated or revoked automatically. See [relay verification](identity-relay-renewal.md).

## Evidence and limits

Public sources consulted on 20 October 2026:

- [Discovery](https://api.ample.computer/.well-known/poppy.json)
- [Authorization server metadata](https://api.ample.computer/.well-known/oauth-authorization-server/poppy)
- [MCP resource metadata](https://api.ample.computer/.well-known/oauth-protected-resource/mcp)
- [MCP catalogue](https://api.ample.computer/mcp/catalog)
- [Public OpenAPI](https://ample.computer/openapi.json), used as supporting evidence for the read scopes.

Isolated tests covered the exact issuer and endpoints, read-only consent and rejection of write, Ample's callback, the six tools with the published catalogue, rejected key and context injection, resource tokens, rotation, reduced scopes, revocation, refused access, and the absence of uncertain retries. Full suite at the time: **322 tests**.

Account authorization was tested with fixtures, not with a real Ample account. The [later live test](ample-live-preconsent.md) verified discovery, a GPT-6 Luna response, creation of a Session before consent, and opening Ample's real form. It stopped before entering an email: no consent was approved, no Account Token was received, no private infrastructure was read and no remote tools were called.
