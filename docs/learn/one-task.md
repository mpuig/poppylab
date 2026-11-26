# One task, request by request

Robin Ito has a noodle order for Saturday at
[Lantern Noodle Bar](https://food-demo.poppylab.dev), one of Poppy Lab's
fictional Companies. Robin tells Iris, a Personal Agent: _"Move my Saturday
noodle order to Sunday."_ This page follows that task from the first fetch to
the changed order, one trimmed request and response to a step, each linked to
the [specification](https://personalagentprotocol.org/docs/1.0/spec).

The traffic is from 25 and 26 November 2026. The discovery documents and the
tasks response are live; the Session JWT and the signed-in steps come from the
same gateway code, run in-process by the lab's tests, because they need a fictional
customer's consent. URLs are the live ones; tokens are redacted.

## Who does what

| Who                  | What they do in this process                                                                |
| -------------------- | ------------------------------------------------------------------------------------------- |
| Robin, the user      | Asks, signs in on Lantern's page, approves the change.                                      |
| Iris, the agent      | Reads what Lantern publishes, proves who it is, asks for the change.                        |
| Lantern, the Company | Sets what agents may do and the terms, runs sign-in and consent, makes the approved change. |

![The nine requests of one task, in order. Without an access token, the Personal Agent reads what the Company offers, finds its authorization server, opens a Session on the Company's tasks and reads public data. It then asks the authorization server for access, and the user signs in and allows each permission on the Company's own page, after which the agent gets a token. With the access token, the agent reads the order and proposes the change, and the Company answers approval_required with the terms. The user approves, the agent sends the same request with the approval, and the Company makes the change.](../../apps/playground/public/learn-media/diagrams/one-task-sequence.svg "The nine requests of one task: six without an access token, then three with one, and the two moments the user decides.")

## Which request carries what

The model sees none of the credentials.

| Step | Session header | Access token | Who decides                |
| ---- | -------------- | ------------ | -------------------------- |
| 1–2  | no             | no           |                            |
| 3–4  | yes            | no           |                            |
| 5–6  | no             | no           | **the user**, at Lantern   |
| 7–8  | yes            | yes          |                            |
| 9    | yes            | yes          | **the user**, in the agent |

## 1. Find out what the Company offers

The agent fetches one well-known document from the domain the user named
([§3.1](https://personalagentprotocol.org/docs/1.0/spec#discovery)):

```http
GET https://food-demo.poppylab.dev/.well-known/poppy.json
```

```json
{
  "protocol_version": "1.0",
  "organization": { // (1)
    "name": "Lantern Noodle Bar",
    "domain": "food-demo.poppylab.dev"
  },
  "auth": {
    "issuer": "https://food-demo.poppylab.dev",
    "scopes": {
      "orders:read": "See your scheduled orders: dishes, delivery slot, address and price. Read only.",
      "orders:write": "Change a scheduled order: move its slot, or add or remove dishes. …",
      "poppy:browser-sign-in": "Open Lantern's website in the agent's own browser, signed in to your account. …"
    },
    "scope_hints": { // (2)
      "orders:read": { "changes": "none", "personal_data": true },
      "orders:write": { "changes": "irreversible", "personal_data": true },
      "poppy:browser-sign-in": { "changes": "none", "personal_data": true }
    }
  },
  "apis": [
    {
      "type": "openapi",
      "url": "https://food-demo.poppylab.dev/openapi.json",
      "description": "Menu, delivery slots, …"
    }
  ],
  "agent": {
    "protocols": [
      {
        "type": "poppy",
        "endpoint": "https://food-demo.poppylab.dev/poppy/conversations",
        "description": "Lantern's automated agent: …"
      }
    ]
  },
  "web": {
    "browser_session_endpoint": "https://food-demo.poppylab.dev/poppy/browser-session"
  },
  "tasks": { "endpoint": "https://food-demo.poppylab.dev/poppy/tasks" },
  "extensions": { "operations": [{ "version": "3" }] } // (3)
}
```

1. **Who it's dealing with.** The name is the Company's claim; the domain is
   what discovery proved.
2. **What it may ask for.** Three scopes, described for the approver;
   `scope_hints` marks `orders:write` irreversible, so a read-only task can ask
   for `orders:read` alone. The third lets an agent's own browser open
   Lantern's website signed in, read only; an agent without a browser never
   asks for it.
3. **That changes need approval.** Lantern answers a change with exact terms
   and waits for approval
   ([Operations](https://personalagentprotocol.org/docs/1.0/extensions/operations)).

The agent chooses version 1.0, the newest it shares with the Company, and
sends `Poppy-Version: 1.0` on every request after this
([§3.4](https://personalagentprotocol.org/docs/1.0/spec#versions)).

## 2. Find the authorization server

Sign-in is ordinary OAuth: the protected resource metadata
([RFC 9728](https://www.rfc-editor.org/rfc/rfc9728)) names the issuer, whose
metadata ([RFC 8414](https://www.rfc-editor.org/rfc/rfc8414)) lists the
endpoints:

```json
// GET /.well-known/oauth-protected-resource
{
  "resource": "https://food-demo.poppylab.dev",
  "authorization_servers": ["https://food-demo.poppylab.dev"],
  "scopes_supported": ["orders:read", "orders:write", "poppy:browser-sign-in"]
}
```

```json
// GET /.well-known/oauth-authorization-server (trimmed)
{
  "issuer": "https://food-demo.poppylab.dev",
  "authorization_endpoint": "https://food-demo.poppylab.dev/oauth/authorize",
  "pushed_authorization_request_endpoint": "https://food-demo.poppylab.dev/oauth/par",
  "token_endpoint": "https://food-demo.poppylab.dev/oauth/token",
  "token_endpoint_auth_methods_supported": ["private_key_jwt"],
  "token_endpoint_auth_signing_alg_values_supported": ["ES256", "PS384"],
  "client_id_metadata_document_supported": true,
  "dpop_signing_alg_values_supported": ["ES256"]
}
```

`client_id_metadata_document_supported` means the agent doesn't register: its
`client_id` is a URL Lantern fetches for the agent's name and public keys.
`private_key_jwt` means the agent signs, never sharing a secret
([§4.1](https://personalagentprotocol.org/docs/1.0/spec#agent-identity)).

## 3. Open a Session, signed out

The agent first asks which tasks Lantern doesn't offer through the protocol
([§9](https://personalagentprotocol.org/docs/1.0/spec#task-coverage)), with its
first **Session header**:

```http
GET https://food-demo.poppylab.dev/poppy/tasks
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
            "url": "https://food-demo.poppylab.dev/openapi.json",
            "operation_id": "change_order"
          }
        ]
      }
    },
    { "task": "Change the delivery address of an order" }
  ],
  "skill_index": {
    "$schema": "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    "skills": [
      {
        "name": "change-scheduled-order",
        "description": "Change a customer's scheduled Lantern Noodle Bar order through Lantern's API: move it to another delivery slot, add dishes or remove dishes. Use it when the customer asks to move an order that hasn't been delivered yet, or to change what is in it.",
        "type": "skill-md",
        "url": "/poppy/skills/change-scheduled-order/SKILL.md",
        "digest": "sha256:b282bf11a838b35b4215b9d55f499d09f1f8b1d1aa9d844cf61b7d885d3691e2"
      }
    ]
  },
  "feedback": { "endpoint": "https://food-demo.poppylab.dev/poppy/feedback" }
}
```

Moving an order isn't excluded, so the agent carries on. A cancellation would
already have Lantern's alternative.

The response also lists what Lantern publishes to help agents: one skill, a
file that says how to change a scheduled order with its API. An agent can
fetch it and check it against the digest.

The Session header has no OAuth equivalent: a JWT the agent signs for **every**
request, signed in or not
([§5.2](https://personalagentprotocol.org/docs/1.0/spec#session-header)).
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
  "iss": "https://poppylab.dev/agent/client.json", // (1)
  "aud": "https://food-demo.poppylab.dev",
  "sub": "usr_noodles", // (2)
  "sid": "RL9MLQq-RIp2pVW0a-dpEOLXBkNton_C",
  "htm": "GET", // (3)
  "htu": "https://food-demo.poppylab.dev/poppy/tasks",
  "iat": 1795599637,
  "jti": "qrMTRBeYhMszmk2XciKTTnBZFT43jqQ1"
}
```

1. **`iss`** is the agent's `client_id`. Lantern checks that one of the agent's
   keys signed the delegation in `poppy_dlg`, which vouches for the short-lived
   key that signed this JWT. The long-term key never signs a request.
2. **`sub`** is the agent's pseudonymous ID for the user, stable but different
   at each Company; `sid` names the Session. Together they let Lantern
   attribute requests, keep state per Session and rate-limit per user before
   sign-in.
3. **`htm` and `htu`** bind the JWT to this one request, so a copied header
   can't be replayed against another URL.

## 4. Read public data

The agent reads the menu and the delivery slots, still signed out:

```http
GET https://food-demo.poppylab.dev/api/menu
Poppy-Version: 1.0
Poppy-Session: eyJ0eXAi…
```

An existing public API only gains the Session header check.

## 5. Ask the user for access

To read and change the order, the agent asks for `orders:read` and
`orders:write`. It pushes the request first
([RFC 9126](https://www.rfc-editor.org/rfc/rfc9126), which Lantern offers), so
the parameters never travel in a URL:

```http
POST https://food-demo.poppylab.dev/oauth/par
DPoP: eyJ0eXAiOiJkcG9wK2p3dCIs…
Content-Type: application/x-www-form-urlencoded

client_id=https://poppylab.dev/agent/client.json
&client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
&client_assertion=eyJhbGciOiJFUzI1NiIs…
&response_type=code&scope=orders:read orders:write
&code_challenge=…&code_challenge_method=S256
&redirect_uri=https://poppylab.dev/api/account/callback&prompt=consent
```

The user opens Lantern's consent page, which says **"Connecting Iris from
poppylab.dev"**: the name is the agent's claim, the host is what Lantern
verified. The user signs in to Lantern and allows or refuses each permission;
the agent never sees the password.

## 6. Get a token

The agent exchanges the authorization code Lantern returns, proving who it is
again and binding the token to its DPoP key
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
([§4.4](https://personalagentprotocol.org/docs/1.0/spec#refresh-tokens)).

## 7. Read the order

Signed-in requests carry the Session header _and_ the access token; the Session
JWT includes a hash of the token, tying them together:

```http
GET https://food-demo.poppylab.dev/api/account/orders
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

The agent declares the Operations extension, so Lantern doesn't apply the
change: it answers with the exact terms
([Operations §4](https://personalagentprotocol.org/docs/1.0/extensions/operations#approval-required)):

```http
POST https://food-demo.poppylab.dev/api/account/orders/ord_LNB2001/changes
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

The user approves the `terms`, and the `revision` pins them: if the order
changes on Lantern's side or the agent asks for something else, a new revision
replaces it and the old approval no longer applies.

## 9. The user approves, the agent resends

The agent shows the terms and asks the user. The model can read and explain
them but can't approve them: in Iris, approving is a button outside the chat,
and chat text never counts as an approval.

The agent resends the identical request with the approval:

```http
POST https://food-demo.poppylab.dev/api/account/orders/ord_LNB2001/changes
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

If the agent can't tell whether the request worked, it resends it with the same
approval. Lantern returns the same result and doesn't move the order twice
([Operations §7](https://personalagentprotocol.org/docs/1.0/extensions/operations#at-most-once)).

## What each side got

**Lantern** knows the agent, user and Session before sign-in and applies no
change without approved terms.

**The user** shares no password, sees the change and price first, and can
disconnect the agent at any time.

## For the technical reader

- [Playground](https://poppylab.dev/playground): ask Lantern to move an order as
  a test customer; the Inspector shows every request.
- [Poppy compared](compared.md), [Approvals](operations.md) and
  [Conversations](conversations.md): the ideas.
- [Build a Company](build-a-company.md) and
  [Build a Personal Agent](build-an-agent.md): the steps for each side.
- Code: [`packages/pap-company`](../../packages/pap-company) (the gateway),
  [`apps/lantern`](../../apps/lantern) (the business routes) and
  [`apps/playground/lib/runtime.ts`](../../apps/playground/lib/runtime.ts) (the
  agent).
