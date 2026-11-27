# Signing in: Direct, Device and Mediated

How does a Personal Agent get access to a user's account at a Company, and why
are there three ways to do it? Direct and Device Sign-In let the user approve
on the Company's own page, so the Company knows which agent acts and what it
may do. Mediated Sign-In hands the agent the user's credentials instead, and
the protocol is retiring it.

## The three ways side by side

| Sign-in                                                                            | Where the user approves                                               | What the agent holds                      | At the lab's Companies |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------- | ---------------------- |
| [Direct](https://personalagentprotocol.org/docs/1.0/spec#direct-sign-in)           | The Company's consent page, opened in a browser and redirected back   | An authorization code, swapped for tokens | All five               |
| [Device](https://personalagentprotocol.org/docs/1.0/spec#device-sign-in)           | The Company's consent page, on any device, after entering a code      | A device code, which it polls with        | All but Harborline     |
| [Mediated](https://personalagentprotocol.org/docs/1.0/extensions/mediated-sign-in) | Nowhere: the agent sends the user's credentials to the token endpoint | The user's credentials, while it signs in | None                   |

Each ends with the same tokens
([§4.7](https://personalagentprotocol.org/docs/1.0/spec#scopes)). Direct
Sign-In is the preferred type: a Company that offers sign-in SHOULD offer it,
and an agent SHOULD use it where it is offered
([§4](https://personalagentprotocol.org/docs/1.0/spec#oauth)). Iris always
uses Direct Sign-In, which
[One task](one-task.md#5-ask-the-user-for-access) follows request by request.

## Device Sign-In, for an agent without a browser

Device Sign-In is the OAuth device authorization grant
([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)). It suits an agent with no
browser at hand, such as a voice assistant or a command-line tool: the agent
shows a link and a short code, and the user approves on whatever device they
like. Four of the lab's Companies offer it, listing a
`device_authorization_endpoint` in their issuer metadata.

The agent asks for a code with its client assertion and the scopes it needs. A
Lantern answer, with the codes left out:

```json
{
  "device_code": "<redacted>",
  "user_code": "…",
  "verification_uri": "https://food-demo.poppylab.dev/device",
  "verification_uri_complete": "https://food-demo.poppylab.dev/device?user_code=…",
  "expires_in": 600,
  "interval": 5
}
```

Before it shows the link, the agent checks that its host is the Company's
issuer or domain, and shows the Company's name and domain next to the code. The
`device_code` stays with the agent, because whoever holds it gets the tokens.

On the Company's side, the lab's Companies run it this way:

- **The code.** Eight letters, drawn from twenty consonants, unique among the
  requests a Company holds. It lasts ten minutes and works once.
- **The page.** `/device` on the Company's own domain, headed "Connect an agent
  to your Juniper Market account". It tells the user to enter a code only if
  they asked an agent to sign in themselves. Opening it, with or without the
  code in the link, approves nothing.
- **The consent page.** The same page as Direct Sign-In, shown for every
  request, with the code on it so the user can check it matches the agent's.
  It says that allowing signs the agent in on the device where the sign-in
  started, and to choose Don't allow for a code someone sent.
- **The polls.** The agent polls the token endpoint with the device code every
  `interval` seconds. Until the user answers it gets `authorization_pending`;
  a poll that comes too soon gets `slow_down` and five more seconds;
  then `access_denied`, `expired_token` or the tokens.
- **Wrong codes.** Ten from one source in ten minutes, then the page refuses
  more for a while.

Device Sign-In is easier to use for phishing than Direct Sign-In: anyone can
start a request and talk a user into approving it
([RFC 10027](https://www.rfc-editor.org/rfc/rfc10027) §4.1.1). The protocol
requires the best practices of RFC 10027 §2 from both sides, and the warnings
on the lab's pages are those mitigations.

## Why Harborline offers Direct Sign-In only

RFC 10027 §6.2.1.5 advises against the device authorization grant for
sensitive or high-value resources, and the
[guides](https://personalagentprotocol.org/docs/1.0/guides#company-device) say
that a Company whose accounts hold them, such as a bank, may offer only Direct
Sign-In. Harborline, the lab's bank, does: its issuer metadata has no
`device_authorization_endpoint` and no device grant, and an agent signs in
through Harborline's consent page in a browser.

## Mediated Sign-In, and why the lab doesn't offer it

In Mediated Sign-In the Personal Agent signs in for the user at the Company's
token endpoint, with credentials the user gave it for that Company, such as an
email and password, and a one-time code when the Company asks for one. It is an
extension, not part of the core specification, and its text calls it
transitional: a Company SHOULD offer it only until it can add Direct or Device
Sign-In, and the protocol plans to retire it on 17 March 2027.

None of the lab's Companies offers it, for the reasons the extension gives.
Each already offers Direct Sign-In, so the extension's own rule says to stop.
With Mediated Sign-In the user's password leaves the Company, passkeys can't
work, and the user approves no scopes on the Company's own page: the Company
can only hold the agent to the scopes the extension lists. The validator's two Mediated
Sign-In checks skip at all five Companies ([Validator results](validator.md)).

## The lab's test sign-in pages

The lab's Companies have no real accounts. Their consent pages list fictional
test customers, such as Elena Maren and Robin Ito at Lantern, and the user
picks one: "Test customers. Choosing one doesn't verify who you are."
Juniper's own website signs in the same way, at `/site/login`.

A deployment can add one shared demo password, set as a Worker secret such as
`JUNIPER_PASSWORD_HASH`; the page then asks for it before it lets anyone choose
a customer. On the live lab, no Company asks for one. A demo password keeps
strangers out of a test environment, but it doesn't stop an agent's own
browser, which can type it as a person would. It belongs to the lab only: a
real Company's sign-in is the user's own account, on the Company's page.

## Go deeper

- Screen by screen: [Signing in and giving permission](how-it-works/signing-in-and-giving-permission.md).
- Request by request: [One task](one-task.md#5-ask-the-user-for-access).
- Apply it: [Build a Company](build-a-company.md) and
  [Build a Personal Agent](build-an-agent.md).
- The rules: [§4](https://personalagentprotocol.org/docs/1.0/spec#oauth) and
  the [Mediated Sign-In extension](https://personalagentprotocol.org/docs/1.0/extensions/mediated-sign-in).
