# One task, request by request

A user asks their Personal Agent: _"Move my Saturday noodle order to Sunday."_
This page follows that task at
[Lantern Noodle Bar](https://noodles.poppylab.dev), one of Poppy Lab's
fictional Companies, from the first fetch to the changed order. Each step
shows the real request and response, trimmed, and links to the part of the
[specification](https://personalagentprotocol.org/docs/1.0/spec) that
defines it.

The discovery documents and the tasks response come from the live site. The
Session JWT and the signed-in steps come from the same gateway code run
in-process by our tests, because they need a fictional customer's consent;
URLs are shown as the live ones and tokens are redacted.

The model sees none of the credentials. Which requests carry what:

| Step | Request                        | Session header | Access token | Who decides                |
| ---- | ------------------------------ | -------------- | ------------ | -------------------------- |
| 1    | `GET /.well-known/poppy.json`  | –              | –            | –                          |
| 2    | OAuth and resource metadata    | –              | –            | –                          |
| 3    | `GET /poppy/tasks`             | yes            | –            | –                          |
| 4    | `GET /api/menu`                | yes            | –            | –                          |
| 5    | `POST /oauth/par`, consent     | –              | –            | **the user**, at Lantern   |
| 6    | `POST /oauth/token`            | –              | –            | –                          |
| 7    | `GET /api/account/orders`      | yes            | yes          | –                          |
| 8    | `POST …/changes`               | yes            | yes          | –                          |
| 9    | same `POST`, with the approval | yes            | yes          | **the user**, in the agent |

## 1. Find out what the Company offers

The agent fetches one well-known document from the domain the user named
([§3.1](https://personalagentprotocol.org/docs/1.0/spec#discovery)):

```http
GET https://noodles.poppylab.dev/.well-known/poppy.json
```

```json
{
  "protocol_version": "1.0",
  "organization": {
    "name": "Lantern Noodle Bar",
    "domain": "noodles.poppylab.dev"
  },
  "auth": {
    "issuer": "https://noodles.poppylab.dev",
    "scopes": {
      "orders:read": "See your scheduled orders: dishes, delivery slot, address and price. Read only.",
      "orders:write": "Change a scheduled order: move its slot, or add or remove dishes. …"
    },
    "scope_hints": {
      "orders:read": { "changes": "none", "personal_data": true },
      "orders:write": { "changes": "irreversible", "personal_data": true }
    }
  },
  "apis": [
    {
      "type": "openapi",
      "url": "https://noodles.poppylab.dev/openapi.json",
      "description": "Menu, delivery slots, …"
    }
  ],
  "agent": {
    "protocols": [
      {
        "type": "poppy",
        "endpoint": "https://noodles.poppylab.dev/poppy/conversations",
        "description": "Lantern's automated agent: …"
      }
    ]
  },
  "tasks": { "endpoint": "https://noodles.poppylab.dev/poppy/tasks" },
  "extensions": { "operations": [{ "version": "3" }] }
}
```

From this one document the agent learns:

- **who it's dealing with.** The name is the Company's claim; the domain is
  what discovery proved. A good agent shows both before acting.
- **what it may ask for.** Two scopes, each described for the person who'll
  approve it. `scope_hints` says `orders:write` makes irreversible changes, so
  an agent planning a read-only task should ask for `orders:read` alone.
- **how it can work.** An OpenAPI description and a Company Agent it can talk
  to. The agent picks per task; here, the API.
- **that changes need approval.** `extensions.operations` means Lantern
  will answer a change with the exact terms and wait for an approval
  ([Operations](https://personalagentprotocol.org/docs/1.0/extensions)).

The agent chooses version 1.0, the newest it shares with the Company, and
sends `Poppy-Version: 1.0` on every request after this
([§3.4](https://personalagentprotocol.org/docs/1.0/spec#versions)).

## 2. Find the authorization server

Sign-in is ordinary OAuth. The domain's protected resource metadata
([RFC 9728](https://www.rfc-editor.org/rfc/rfc9728)) names the issuer, and the
issuer's metadata ([RFC 8414](https://www.rfc-editor.org/rfc/rfc8414)) lists
the endpoints:

```json
// GET /.well-known/oauth-protected-resource
{
  "resource": "https://noodles.poppylab.dev",
  "authorization_servers": ["https://noodles.poppylab.dev"],
  "scopes_supported": ["orders:read", "orders:write"]
}
```

```json
// GET /.well-known/oauth-authorization-server (trimmed)
{
  "issuer": "https://noodles.poppylab.dev",
  "authorization_endpoint": "https://noodles.poppylab.dev/oauth/authorize",
  "pushed_authorization_request_endpoint": "https://noodles.poppylab.dev/oauth/par",
  "token_endpoint": "https://noodles.poppylab.dev/oauth/token",
  "token_endpoint_auth_methods_supported": ["private_key_jwt"],
  "token_endpoint_auth_signing_alg_values_supported": ["ES256", "PS384"],
  "client_id_metadata_document_supported": true,
  "dpop_signing_alg_values_supported": ["ES256"]
}
```

Two lines matter more than the rest. `client_id_metadata_document_supported`
means the agent doesn't register: its `client_id` is a URL, and Lantern fetches
the agent's name and public keys from it. `private_key_jwt` means the agent
proves who it is with a signature, never a shared secret
([§4.1](https://personalagentprotocol.org/docs/1.0/spec#agent-identity)).

## 3. Open a Session, signed out

Before anything else, the agent asks which tasks Lantern chose not to offer
through the protocol
([§9](https://personalagentprotocol.org/docs/1.0/spec#task-coverage)). This is
its first request with a **Session header**:

```http
GET https://noodles.poppylab.dev/poppy/tasks
Poppy-Version: 1.0
Poppy-Session: eyJ0eXAiOiJwb3BweS1zZXNzaW9uK2p3dCIs…
```

```json
{
  "excluded_tasks": [
    {
      "task": "Cancel an order",
      "alternative": {
        "instructions": "Scheduled orders can't be cancelled through the protocol. They can be moved to another slot instead.",
        "references": [
          {
            "type": "openapi",
            "url": "https://noodles.poppylab.dev/openapi.json",
            "operation_id": "change_order"
          }
        ]
      }
    },
    { "task": "Change the delivery address of an order" }
  ],
  "feedback": { "endpoint": "https://noodles.poppylab.dev/poppy/feedback" }
}
```

Moving an order isn't excluded, so the agent carries on. Had the user asked to
cancel, the agent would already know the answer, and Lantern's suggestion,
without trying.

The Session header is the part of Poppy with no OAuth equivalent. It's a JWT
the agent signs for **every** request, signed in or not
([§5.2](https://personalagentprotocol.org/docs/1.0/spec#the-session-header)).
Decoded:

```json
// header
{
  "typ": "poppy-session+jwt",
  "alg": "ES256",
  "kid": "vpaezDlkYJn4xAGXXGZcdySGGS0F_37OZNa9nVWDNG8",
  "poppy_dlg": "eyJhbGciOiJFUzI1NiIsInR5cCI6InBvcHB5LWRlbGVnYXRpb24rand0Iiw…"
}
// payload
{
  "iss": "https://poppylab.dev/agent/client.json",
  "aud": "https://noodles.poppylab.dev",
  "sub": "usr_noodles",
  "sid": "RL9MLQq-RIp2pVW0a-dpEOLXBkNton_C",
  "htm": "GET",
  "htu": "https://noodles.poppylab.dev/poppy/tasks",
  "iat": 1795599637,
  "jti": "qrMTRBeYhMszmk2XciKTTnBZFT43jqQ1"
}
```

- `iss` is the agent's `client_id`. Lantern fetches it, finds the agent's keys,
  and checks that one of them signed the delegation in `poppy_dlg`, which
  vouches for the short-lived key that signed this JWT. The agent's long-term
  key never signs a request.
- `sub` is a stable, pseudonymous ID for the user, chosen by the agent and
  different at each Company. `sid` names the Session. Together they let
  Lantern attribute every request, keep state per Session and rate-limit per
  user, all before anyone signs in.
- `htm` and `htu` bind the JWT to this one request, so a copied header can't
  be replayed against another URL.

## 4. Read public data

The agent reads the menu and the delivery slots, still signed out:

```http
GET https://noodles.poppylab.dev/api/menu
Poppy-Version: 1.0
Poppy-Session: eyJ0eXAi…
```

Nothing new here. That's the point: an existing public API only gains the
Session header check.

## 5. Ask the user for access

To see the order, the agent needs `orders:read`, and to change it,
`orders:write`. It pushes the authorization request first
([RFC 9126](https://www.rfc-editor.org/rfc/rfc9126), offered by Lantern), so
the parameters never travel in a URL:

```http
POST https://noodles.poppylab.dev/oauth/par
DPoP: eyJ0eXAiOiJkcG9wK2p3dCIs…
Content-Type: application/x-www-form-urlencoded

client_id=https://poppylab.dev/agent/client.json
&client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
&client_assertion=eyJhbGciOiJFUzI1NiIs…
&response_type=code&scope=orders:read orders:write
&code_challenge=…&code_challenge_method=S256
&redirect_uri=https://poppylab.dev/api/account/callback&prompt=consent
```

Then the user opens Lantern's own consent page. It says **"Connecting Iris
from poppylab.dev"**: the name is what the agent claims, the host is what
Lantern verified. The user signs in to Lantern, as they always do, and allows
or refuses each permission. The agent never sees the password.

## 6. Get a token

The authorization code comes back to the agent's redirect URI, and the agent
exchanges it, proving again who it is and binding the token to its DPoP key
([RFC 9449](https://www.rfc-editor.org/rfc/rfc9449)):

```json
{
  "access_token": "<redacted>",
  "token_type": "DPoP",
  "expires_in": 3600,
  "scope": "orders:read orders:write",
  "refresh_token": "<redacted>"
}
```

A stolen token is useless without the private key that signs each DPoP proof,
and the refresh token works only with that same key
([§4.4](https://personalagentprotocol.org/docs/1.0/spec#refreshing-tokens)).

## 7. Read the order

Signed-in requests carry the Session header _and_ the access token, and the
Session JWT includes a hash of the token, tying the two together:

```http
GET https://noodles.poppylab.dev/api/account/orders
Poppy-Version: 1.0
Poppy-Session: eyJ0eXAi…
Authorization: DPoP <access token>
DPoP: eyJ0eXAiOiJkcG9wK2p3dCIs…
```

```json
{
  "orders": [
    {
      "id": "ord_LNB2001",
      "status": "scheduled",
      "slot": { "id": "sat-1230", "label": "Saturday 12:30–13:00" },
      "version": 1,
      "items": [
        {
          "name": "Miso vegetable ramen",
          "quantity": 1,
          "line_total_cents": 1350
        }
      ],
      "total_cents": 1650
    }
  ]
}
```

## 8. Propose the change

The agent asks for the change. It declares the Operations extension, so Lantern
doesn't apply it: it answers with the exact terms
([Operations §4](https://personalagentprotocol.org/docs/1.0/extensions)):

```http
POST https://noodles.poppylab.dev/api/account/orders/ord_LNB2001/changes
Poppy-Version: 1.0
Poppy-Extensions: "operations";v="3"
Poppy-Session: eyJ0eXAi…
Authorization: DPoP <access token>

{ "slot_id": "sun-1300" }
```

```json
HTTP/1.1 403 Forbidden

{
  "error": "approval_required",
  "operation": {
    "operation_id": "op_P9yN9PnUo_teWd3-Femrsqg_",
    "revision": "1795599649-m-M2VJxTga9pW4gq",
    "summary": "Change order ord_LNB2001 for Robin Ito. Move delivery from Saturday 12:30–13:00 to Sunday 13:00–13:30. …",
    "terms": {
      "order_id": "ord_LNB2001",
      "from_slot": "sat-1230",
      "to_slot": "sun-1300",
      "new_total_cents": 1650,
      "price_difference_cents": 0,
      "currency": "USD"
    },
    "expires_at": "2026-11-25T09:50:49.143Z"
  }
}
```

Nothing has changed yet. The `terms` are what the user approves, and the
`revision` pins them: if the order changes on Lantern's side, or the agent asks
for something else, there's a new revision and the old approval no longer
applies.

## 9. The user approves, the agent resends

The agent shows the terms and asks the user. The model can read and explain
them; it can't approve them. In Iris, approving is a button outside the chat,
and chat text never counts as an approval.

The agent sends the identical request again, with the approval:

```http
POST https://noodles.poppylab.dev/api/account/orders/ord_LNB2001/changes
Poppy-Approval: operation_id="op_P9yN9PnUo_teWd3-Femrsqg_", revision="1795599649-m-M2VJxTga9pW4gq", approver="user", approved_at=1795600000, input_type="tap"
…same headers and body…
```

```json
HTTP/1.1 200 OK

{
  "operation_id": "op_P9yN9PnUo_teWd3-Femrsqg_",
  "summary": "Order ord_LNB2001 changed: Sunday 13:00–13:30, total USD 16.50. …",
  "data": { "id": "ord_LNB2001", "slot": { "id": "sun-1300", "label": "Sunday 13:00–13:30" }, "version": 2 }
}
```

If the connection drops and the agent can't tell whether this worked, it sends
the same request with the same approval again. Lantern answers with the same
result and doesn't move the order twice
([Operations §7](https://personalagentprotocol.org/docs/1.0/extensions)).

## What the Company got, and the user

Put the steps side by side and the trade becomes clear.

**Lantern** knew which agent was calling (step 3, verified, not a user-agent
string), on behalf of which pseudonymous user, in which Session, before
anyone signed in. It decided what that agent could see and do with its own
scopes, and it never applied a change without exact terms approved for that
revision. It used its own sign-in page, its own consent wording and its
existing API.

**The user** gave the agent two permissions, not their password, on Lantern's
own page. They saw the exact change and its price before it happened. They
can disconnect the agent from Lantern's website at any time, without logging
out of anything else.

## Try it

- Run the same task yourself at [poppylab.dev/playground](https://poppylab.dev/playground):
  connect to Lantern, sign in as a test customer and ask to move an order. The
  Inspector shows every request.
- The Company side is [`packages/pap-company`](../../packages/pap-company)
  (gateway) and [`apps/lantern`](../../apps/lantern) (the business routes); the
  agent side is [`apps/playground/lib/runtime.ts`](../../apps/playground/lib/runtime.ts).
