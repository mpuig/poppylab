# Least-privilege permissions and account recovery

## Read first

Poppy asks for the Company's read scopes when you choose **Sign in**. A read-only account can look at data but can't propose or confirm changes. The **Request change permission** control opens another consent, this time for read and write. It's only offered if the Company advertises write access; the server also checks the advertised scopes before building the authorization. No new scopes or per-service permissions are added.

The human route accepts `access: "read"` (the default) or `access: "write"` (read plus write), not arbitrary scopes. No model tool starts this consent. A scope block tells the user which control to use, without closing their read access.

Juniper accepts any non-empty subset of its two independent scopes, including write alone and the reverse order. It rejects unknown, duplicated or empty scopes. The requested scope is bound to the consent's nonce and PKCE: sending `write=yes` on a form requested for read only can't raise it. The page describes only the requested permissions; there's no write checkbox in the read-only variant. With read plus write, write can be unticked; with write alone, read isn't granted implicitly.

Poppy offers the two choices above, not a general picker of custom scopes. It rejects a token response that grants permissions beyond what was requested. Renewal also asks explicitly for the current scopes and rejects a wider response: an expiring Session can't turn read into write.

## The consent page

The five Companies' consent pages are one sheet in each Company's own look (`packages/pap-core/src/consent-sheet.ts`): the agent's name with its verified host; "Sign in as", the two test customers as a choice of one; "What Iris may do", as what it may read without asking again and the changes it may propose, each of which waits for a separate approval; one sentence on where to take the permission away; and the same two buttons, "Don't allow" and "Allow". The page names no scope and uses no protocol term. It posts the same fields as before (`nonce`, `account`, `password`, `decision`, and each Company's own, such as `write` or Harborline's `allow_<scope>`), so what the server binds and checks is unchanged.

One line is the same at every Company. When an agent asks for `poppy:browser-sign-in` (§6), the sheet adds a choice under its own heading, after the Company's own further choices: "On this website", then a ticked box "Browse signed in, read only" with the text "The agent's own browser may open this website signed in to your account. It sees what the read permissions above cover, and can't change anything here." The customer can untick it, and the rest is still granted; asked for alone, it can't be unticked, since allowing would allow nothing. The gateway grants the scope only when it was requested and the form posts `allow_browser=yes`, and a Company's `selectScopes` never sees it. "Connected agents" on the Company's website says it in the same words: "On this website: Browse signed in, read only." Iris has no browser and never asks for this scope: `consentScopes` leaves it out of both the read and the change request, whatever the Company's hints say, and the Company profile lists it with "Iris has no browser, so it doesn't ask for this". What a browser joined with it can see and do is in [Poppy 1.0](poppy-1.0.md#web-browsing-6).

The page opens on the first test customer, unless this browser already allowed the same agent to reach a customer and the agent still holds that permission: then it opens on that customer, so a request for more permission stays with the account the agent is signed in to unless the customer chooses the other. The gateway reads this from its own records, the grant and the `pap_browser` cookie of the browser that approved it (`allowedBefore` in `packages/pap-company/src/gateway/signin.ts`), and from nothing the agent sends. It needs `isolation: "visitor"`, the only mode in which the gateway tells browsers apart.

## Widening is not acting

Each consent uses a new candidate Session. Until it completes successfully, the previous access, its conversation and its proposals stay in place. A counter of completed consents avoids mistaking a refusal for success just because the previous account was still connected.

On success, the active access is replaced and the conversation from before the first account access is kept: up to 10 messages for the model, and for the page everything it showed while signed out, as it showed it (Company content, each answer's label, steps and data). The callback stores that public part, and the UI's polling restores what the server returns instead of emptying it. On later consents only that public part is kept: private turns, what the page showed with an account and earlier proposals are dropped, because the Company's page may select another account. The transcript marks each entry shown while signed out, and a sign-in drops every entry without the mark. Sign out also removes the public copy.

There is one exception, when the Company's answers show that the new sign-in is for the same account. A token response names no account, so the only thing that says so is a conversation with the Company's own agent that has used the account ([§8.2](https://personalagentprotocol.org/docs/1.0/spec#conversation-requests)): the Company refuses it signed out with a challenge, and answers `conversation_not_found` to any other account. The callback reads that conversation's events three times, changing nothing: signed out (it must be refused, or no account has used it and it says nothing), with the sign-in being replaced (it must answer), and with the new one (it must answer). Only then the whole conversation stays, with its proposals. Without such a conversation, as when Iris only called the Company's API, there is no way to tell, and the conversation goes back to its public part.

History lists a conversation under its first request. When a sign-in or a sign-out removes that request, the conversation is listed under the first one still shown, or as having no messages; once it ends with nothing left to read, it is no longer listed. The interface asks you to request the change again; it doesn't replay the message or the purchase. Each operation keeps its own separate human approval.

Earlier tokens and grants aren't widened or revoked automatically. Revoking the old grant ends its tokens without invalidating the new one. Earlier grants can be managed from the Company website's connected-agents section; Sign out in Poppy revokes its active grant, not every historical grant.

## Visible recovery

| Situation                     | Behaviour                                                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Insufficient permission       | HTTP 403 and guidance to request permissions; approval blocked locally before anything is sent if write access is missing.                                      |
| Access no longer accepted     | Explains that it may have expired or been revoked, without inventing an exact cause, and offers Sign in. What the page showed with the account goes, see below. |
| Expired proposal              | A local HTTP 410 when approving; nothing is sent. Ask for another proposal if needed.                                                                           |
| Changed terms                 | The new terms take the place of the approved ones in "Needs you", and their card says the Company returned them instead. Approve them separately, or decline.   |
| Refused request               | HTTP 409. The proposal keeps waiting and its card says the Company refused it, with the Company's status and error code. Approve again once it is sorted out.   |
| Uncertain response            | HTTP 502 and the only action is to retry the same approval. No purchase is retried.                                                                             |
| Refused or incomplete consent | The previous access isn't taken as a new consent, and its context isn't cleared.                                                                                |

When Iris learns that the Company no longer takes the sign-in, for example after the customer disconnects the agent on the Company's website, the conversation goes back to its public part, as at a sign-in that may be for another account: the answers Iris read with the account, their data and the proposals leave the page and the model's history, and what was shown signed out stays, with the message about the lost access. This happens once, in the request that got the Company's refusal (`forgetLostAccount` in `lib/transcript.ts`). One kind of proposal stays: an approval that was sent and whose outcome is unknown, so the same approval can still be retried once the access is back. The run keeps the sign-in itself, to revoke or replace it at the next one, so what is said afterwards is not marked as shown signed out and goes at the next sign-in.

A 5xx with an ambiguous error code isn't presented as a confirmed revocation. Arbitrary descriptions received from the Company aren't shown. Retry-After restrictions still apply.

## Tests

```sh
pnpm scenarios permissions
```

- Juniper's account tests: independent subsets and a tampered form that can't widen access.
- `authority-regression.test.ts`: read → blocked proposal → new consent → proposal → explicit approval; old token unchanged and independent revocation.
- Poppy route tests: default request, explicit widening, rejection of an over-broad grant, insufficient permissions, expiry, unavailable access and uncertain outcome.
- `account-permissions.test.ts`: scope choice, subset validation, recovery and detection of a completed consent.

The visual review was done in two desktop and mobile batches: Juniper's real consent pages without submitting them, and Poppy's read-only and failed-access states with browser fixtures, without issuing grants, reading account data or calling models. The review was done in-thread, with no independent reviewer.
