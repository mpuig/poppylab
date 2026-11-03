# Versioned fictional profiles

This extends the [Juniper service foundation](juniper-services.md). A profile is contact/shipping data for future fictional purchases, **not** a login identity, credential, agent registration or authorization grant.

## Customer and agent flows

- `/account` → **Perfil** → **Editar perfil** opens a prefilled form. Explicit **Guardar perfil** uses the separate browser session and exact Origin. Only fictional data is appropriate; email must end in `.invalid` and no email is sent.
- The form captures its opening version. Polling updates the read view but does not replace a draft or silently rebase its version. Conflicts return 409 and preserve the draft; **Cargar los datos actuales** is an explicit reload that replaces it. Cancel hides the editor. Controls are disabled during save; uncertain responses instruct refresh before retry.
- The agent reads `GET /api/account/profile`, then uses the returned `profile_version` as `version` in `POST /api/account/profile-proposal`. The body requires name, email, address and version; unknown fields and invalid data fail closed. The proposal does not update the profile.
- Company-owned immutable terms include `profile_version`, `before_profile` and `after_profile`. Poppy displays all three exact before/after fields and retains full JSON. Only explicit human approval through existing Operations can apply it. Version mismatches at creation return 409; changes after creation cause confirmation to fail without overwriting current data.
- Website saving, or another approved profile change, increments only the profile version. Shopping basket, recurring delivery and case versions are independent. Existing broad `poppy:read/write` permissions still apply; no implicit service-specific grant is claimed.

## Checkout and historical data

New checkout proposals capture the current profile version, recipient and fictional destination, and name the exact destination in the Company summary. A profile edit invalidates that pending checkout even if the basket did not change. Request fresh terms rather than silently sending to a newer address.

Confirmed new orders persist the reviewed recipient/destination as a snapshot. Later profile edits never rewrite an existing order. Older orders without those fields stay unchanged; the website explicitly says the historical address was not recorded rather than borrowing today's profile. Existing recurring delivery dates/items are unchanged by this milestone.

Old records lazily initialize `profile_version` to 1 while preserving any existing profile. Baskets, deliveries, cases and orders are not reset. A pending checkout from older code without a profile version fails closed and needs a new proposal; it is not retroactively supplied with current terms. Confirmed profile results snapshot data for a stable audit record.

## Contract and limits

- `GET /api/account/profile`: DPoP account Session, `poppy:read`; returns `{profile, profile_version, fictional:true}`.
- `POST /api/account/profile-proposal`: account Session with write authority; OpenAPI tool declares read/write, returns 202 Operation only.
- `POST /site/profile`: browser session + exact Origin; PAP authorization alone cannot replace the browser cookie. Not a model tool.
- Name: 1–80 characters; email: up to 120, normalized to lowercase, `.invalid` only; address: 1–240. Blank values, control characters, missing/invalid integer versions and authority/unknown fields are rejected. The profile is a complete contact snapshot, not an unrestricted JSON patch.

No real delivery validation, verification email, address-book management, identity change, real payment or production authentication is implemented. The deterministic Protocol demo has no profile intent parser; use a configured LLM.

## Evidence

Automated tests cover web/PAP authority separation, read-only write rejection, malformed/real-domain email input, stale draft/proposal rejection, idempotent confirmation, cross-account profile isolation, result immutability, legacy contact/order preservation, independent versions, checkout invalidation and immutable order destinations.

A real GPT-6 Luna / OpenAI compatible run loaded 19 API tools, read the current profile and proposed only a fictional address change while retaining the name/email. It ended awaiting human approval. **No live profile save or confirmation was performed, and no existing customer/order data was modified by this smoke test.** Website save and checkout effects were exercised in isolated fixtures. The browser checked editor population, draft retention on refresh and desktop/mobile layout without submitting the draft. The live proposal can expire normally.

Billing/credits, website checkout/order management, the scenario/fault lab and additional PAP channels remain roadmap work.
