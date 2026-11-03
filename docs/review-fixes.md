# Authorization and persistence review fixes

## Immutable token authority

Juniper account Session Token records now snapshot their granted scopes and original grant hash. API authorization reads that snapshot, not the mutable Session's current scopes/grant. A later refresh or consent cannot promote an older read-only token or attach it to a replacement grant. Revoking its original grant invalidates it even after a second consent in the same Session. Grant checks also bind client and user.

Account GETs require `poppy:read`; POSTs require `poppy:write`. Public endpoints still require a valid signed-out or signed-in DPoP token, without account scopes. These are existing coarse permissions, not new fine-grained service permissions. The model tool contract may require both read and write for proposal workflows.

Existing persisted account access tokens without the new authority snapshot are removed on startup. Their Account Tokens/grants are retained: renew the account Session or sign in again. Historical Operations/customer data are not reset. Token binding, expiry and replay checks remain enforced.

## Stable Company user identities

Poppy now stores an encrypted `company-users.enc` registry in its existing ignored `.poppy/` directory. A verified discovery issuer maps to an opaque random User ID, shared by new runs for that issuer and persisted across restarts. Different issuers get unrelated IDs. The registry is for the current single local operator, not multiple authenticated browser users.

Existing Sessions/grants are never relabeled in place. The first encountered legacy Session can seed an issuer mapping; other old active runs keep their existing identities until they end. New Sessions use the established mapping. This deliberate migration avoids breaking an already issued Account Token while making subsequent runs stable. Multi-user deployment must partition identities by authenticated local user; isolated laboratory personas will need an explicit additional namespace.

## Storage failure containment

Juniper still uses local single-writer snapshots, not a transactional database. If any snapshot save throws, the process latches a storage-failed state and responds with **503 `storage_unavailable_restart_required`**. Subsequent requests are blocked and no later response saves the dirty in-memory state. In-flight handlers cannot publish successful responses after the latch.

Recovery procedure:

1. Stop the affected Company process. Do not blindly retry a confirmation.
2. Preserve the encrypted snapshot/key and fix the storage problem (space, permissions, device health).
3. Restart one Company writer against the same directory.
4. Recover the authoritative Operation status before deciding whether any new approval is needed.

A failure before rename leaves the previous durable state; a failure after rename may have installed the candidate file. Therefore the error is an **uncertain result**, not a claim that nothing happened. Restart reads whichever authenticated snapshot is available; corruption fails closed. This containment prevents a later unrelated request from silently committing a failed response's dirty memory. It does not promise rollback of filesystem writes after rename or distributed transaction semantics.

## Unchanged snapshots

The vault compares the serialized candidate to the last successfully committed snapshot. Identical saves skip encryption, file writes, rename and both fsync calls. Initial state is persisted on its first save; changed state is committed as before. Successful load initializes the comparison baseline. Failed writes never advance it.

Thus unchanged website polling, public reads and rejected requests no longer cause full encrypted rewrites. Requests that really change replay/auth/business data still need durability. Serialization/comparison and map projections remain synchronous O(state size); this is not a database-scale performance solution, and no unsafe debounce delays business commits.

## Consent and evidence

Consent now names profile/address, simulated billing, support messages and the additional proposal actions, and distinguishes immediate read access from separately approved changes. No scopes have been silently added.

Regressions exercise real signed DPoP requests for narrowed-token behavior, missing read scope, reconsent/original-grant revocation, and storage failure/restart with an isolated failing store. Filesystem tests check byte/inode/mtime stability for unchanged snapshots and commits after mutation. User registry tests verify issuer separation, restart persistence and non-destructive legacy adoption. Tests also assert that consent describes the newly authorized data.

No real customer data, payments or Sandbox confirmations were used. These fixes do not establish official PAP conformance or replace an independent security audit.
