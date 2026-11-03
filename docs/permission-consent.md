# Least-privilege permissions and account recovery

## Read first

Poppy asks for the Company's read scopes when you choose **Sign in**. A read-only account can look at data but can't propose or confirm changes. The **Request change permission** control opens another consent, this time for read and write. It's only offered if the Company advertises write access; the server also checks the advertised scopes before building the authorization. No new scopes or per-service permissions are added.

The human route accepts `access: "read"` (the default) or `access: "write"` (read plus write), not arbitrary scopes. No model tool starts this consent. A scope block tells the user which control to use, without closing their read access.

Juniper accepts any non-empty subset of its two independent scopes, including write alone and the reverse order. It rejects unknown, duplicated or empty scopes. The requested scope is bound to the consent's nonce and PKCE: sending `write=yes` on a form requested for read only can't raise it. The page describes only the requested permissions; there's no write checkbox in the read-only variant. With read plus write, write can be unticked; with write alone, read isn't granted implicitly.

Poppy offers the two choices above, not a general picker of custom scopes. It rejects a token response that grants permissions beyond what was requested. Renewal also asks explicitly for the current scopes and rejects a wider response: an expiring Session can't turn read into write.

## Widening is not acting

Each consent uses a new candidate Session. Until it completes successfully, the previous access, its conversation and its proposals stay in place. A counter of completed consents avoids mistaking a refusal for success just because the previous account was still connected.

On success, the active access is replaced and the conversation from before the first account access is kept (up to 10 messages). The callback stores that public part, and the UI's polling restores the history the server returns instead of emptying it. On later consents only that public part is kept: private turns and earlier proposals are dropped, because the Company's page may select another account. Sign out also removes the public copy. The interface asks you to request the change again; it doesn't replay the message or the purchase. Each operation keeps its own separate human approval.

Earlier tokens and grants aren't widened or revoked automatically. Revoking the old grant ends its tokens without invalidating the new one. Earlier grants can be managed from the Company website's connected-agents section; Sign out in Poppy revokes its active grant, not every historical grant.

## Visible recovery

| Situation                     | Behaviour                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Insufficient permission       | HTTP 403 and guidance to request permissions; approval blocked locally before anything is sent if write access is missing.                                          |
| Access no longer accepted     | Explains that it may have expired or been revoked, without inventing an exact cause; offers Sign in and disables approval in the UI. Proposals stay for inspection. |
| Expired proposal              | A local HTTP 410 when approving; nothing is sent. Ask for another proposal if needed.                                                                               |
| Changed terms                 | Review the new revision and approve it separately.                                                                                                                  |
| Uncertain response            | HTTP 502 and the only action is to retry the same approval. No purchase is retried.                                                                                 |
| Refused or incomplete consent | The previous access isn't taken as a new consent, and its context isn't cleared.                                                                                    |

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
