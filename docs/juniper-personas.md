# Independent fictional Company accounts

## Known protocol deviation

The [coverage matrix, A08](pap-coverage.md) now includes the corrected Session rule: exchange and refresh reject `account_mismatch`, including after revocation and signed-out renewal. Poppy prepares a new candidate Session for explicit consent and replaces its old context only after success. Integration tests keep different personas in distinct Sessions. See [protocol corrections](protocol-corrections.md) for evidence and migration limits; this is not a full conformance claim.

## Try it

At `http://juniper.localhost:4100/site/login`, select **Alex Rivers**, **Maya Sol** or **Leo Mar**, then enter the selected account. The account page labels the current persona and links to **Switch fictional account**. Alex's existing profile, purchases, cases and Operations are preserved. Maya starts with apples/broccoli and Tuesday recurrence; Leo with coffee and Saturday recurrence. Their order/case histories start empty, not with invented transactions. Defaults are created lazily once and persisted, never reset on sign-in.

In Poppy, sign out of the current grant if needed, then use **Sign in**. The Company consent form has the same explicit persona selector. Selection is captured in the one-time authorization code and bound into the grant and issued token; it is not a model-controlled account parameter. A successful new consent clears the previous Poppy conversation and local approval list, so they are not carried into another account. This does not cancel Company operations or erase customer data.

The optional local password protects the **whole demo**. It is not a different password for each persona. Anyone allowed into this local test environment may select a fictional persona: this is logical account isolation for protocol testing, not verified real-user authentication or production tenant security. Missing account selections in legacy requests retain Alex compatibility; new forms submit the visible selection. Unknown selections are rejected.

## Revocation from the website

Under **Connected agents → Your agent's access**, select **Show grants**. Each active grant shows its public client, permissions and expiry. **Revoke this grant** is an explicit website action, protected by browser session, exact Origin and page-account binding.

Only grants belonging to that browser's selected account are listed/revocable. Public random grant IDs are separate from Account Tokens and their hashes; no credential is sent to the browser. Revocation removes the grant, immediately rejecting its account API access, Operations and refresh. It does not revoke unrelated grants, log out the website, erase orders or cancel business operations. The next agent API request fails; the Poppy badge is not a real-time revocation subscription. Sign out/re-authorize there to regain access.

Closing the website is not revocation. Switching accounts is not revocation either; an old token retains only its original account authority while its grant remains valid. This makes simultaneous authorized clients possible without moving an existing token to a different account.

## Authority and migration

- Tokens snapshot `accountId`, scopes and original grant. Account handlers use this token-owned account, never the mutable Session's currently selected account. Grant checks bind account, client and agent user.
- Refresh preserves the grant account and rejects an incompatible existing Session. Reconsent can select another account without making old tokens point at it.
- Customer state, profile, basket, recurrence, orders, cases, invoice projections and Operations ownership are partitioned by account. Cross-account object lookups return 404, and linking a foreign order to a case is rejected.
- Pre-persona web sessions, grants and account tokens were exclusively Alex's: migration assigns Alex without touching business records. Tokens missing earlier immutable scope/grant metadata still require renewal, per the review fixes.
- Browser sessions persist the selected account. Logging into another persona replaces the cookie and invalidates that browser's previous session. Mutation requests carry `X-Juniper-Account` from the page's server-rendered account, checked against the session. A stale tab cannot apply a coincidentally matching version from another account. Polling detects an account change and reloads, discarding the old page's drafts rather than rebasing them onto another customer.
- Website grant routes are not advertised as model tools. No reset, arbitrary-account seeding, operator scenario console or additional PAP channel is included here.

## Evidence

Signed-DPoP integration regressions exercise account selection, old-token behavior after reconsent, independent profile/order/case/invoice projections, cross-account order/case/Operation access and confirmation denial, foreign order linkage denial, cross-account and cross-origin revocation rejection, stale-page mutation denial, successful owner revocation, failed refresh afterward, unaffected Maya token and preserved Alex browser session. Existing single-account compatibility, password, shopping/version and storage-failure tests continue to pass. Callback regression verifies conversation/approval reset after successful consent.

Live browser checks selected Maya and Leo and observed their distinct profile/basket/recurrence and empty order histories. Desktop/mobile review showed no horizontal overflow. Business mutations and grant revocation were verified in isolated automated fixtures, not by revoking existing user grants or placing live fictional orders. Alex's existing data and external Sandbox identities/configuration were not reset.
