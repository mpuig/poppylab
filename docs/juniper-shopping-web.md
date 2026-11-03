# Editable shopping and recurring delivery

Open `/account` and choose **Edit basket** or **Edit recurring delivery**. Editors use the same persisted customer records, catalogue, stock bounds, allowed days and totals engine as the agent APIs. There is no duplicate frontend dataset or second pricing implementation.

## Human website actions

- The basket editor shows all four catalogue products, including products not currently present. Integer quantities range from zero to the declared per-product stock cap. Zero removes a line. **Save basket** updates the basket only; it never creates or pays for an order. Checkout remains a separately reviewed, explicitly approved Poppy operation.
- The recurring editor updates its day and all item quantities atomically. It never changes the shopping basket or existing orders. An empty recurring configuration has zero delivery fee/total and is labeled as having no simulated shipment.
- Displayed totals describe saved state, not a price preview of an unsaved draft. Totals are recomputed by the existing Company engine after save.
- Both forms capture their opening entity version. Polling may update the saved-state read view but does not replace drafts or silently update their version. Conflicts return 409 and retain text/quantities; **Load the current data** explicitly replaces the draft from the latest observed state. Cancel discards it on reopening. Save/cancel/reload controls disable while saving.
- An uncertain save instructs refresh before resending. Reusing an old version cannot apply a second update. These are not a general durable idempotency-key implementation.

## Authority and shared invariants

`POST /site/basket` requires `{version, items}`; `POST /site/delivery` requires `{version, items, day}`. `items` is the complete catalogue-keyed numeric quantity map. Missing/unknown product keys, missing/extra authority fields, non-integer/negative/excessive quantities and invalid days are rejected before any business mutation.

Both routes require a live, separate customer browser session and exact Origin. A PAP token alone cannot use them. They are not advertised as model tools and do not confirm Operations. Existing DPoP API protections and mandatory agent approval remain unchanged. The read projection includes public catalogue data and the correct separate basket/delivery versions, not credentials.

The basket's version increments on each website basket save; this invalidates pending basket edits and checkout proposals. Delivery has its own version for day/items; either kind of website delivery change invalidates old agent day/items proposals. Date proposals now capture `delivery_version`, preventing a change-away-and-back (ABA) from making an old proposal valid again. Legacy pending day proposals without that version fail closed and need fresh terms; old records are not silently rewritten.

Conversely, an approved agent change makes an older website draft stale. Unrelated profile, basket and recurring configuration versions remain separate. Confirmed retries do not apply a second mutation. Existing orders are never rewritten and no new order is created by these website edits.

## Evidence and limits

In-process integration tests exercise browser login/session/Origin checks and shared web/API state, including:

- Web basket edits reject prior basket and checkout confirmations, preserving the new quantities and recurring configuration.
- Web delivery edits reject prior day/items confirmations, including changing away and back to the original day.
- Approved fresh agent edits make old browser drafts fail without overwriting the latest data.
- Legacy unversioned day proposals fail closed; fresh confirmation is idempotent.
- Invalid bodies are atomic no-ops; empty configurations have zero totals/fees.
- Actual scoped DPoP tests confirm PAP authorization cannot replace browser authority on these routes.

A live browser checked all eight quantity fields, independent basket/delivery versions, draft preservation on refresh and desktop/mobile layout. It did not submit the drafts or change persisted shopping data. Business mutations/conflicts were exercised in isolated test fixtures, not against the user's existing fictional purchases. Model tools are unchanged (19 total); this milestone adds ordinary website controls, not another PAP channel or a new model tool.

Still pending: website checkout/order management, richer billing/credits, local reproducible scenarios/faults and remaining PAP channels. All products, stock, prices, orders and shipments are fictional. Local single-writer storage is not production transactional commerce.
