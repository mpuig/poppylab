# Plan: an energy utility with an ESPI-shaped extension

Second demo of the "domain standard + Poppy extension" pattern, after `poppylab.dev/fdx` in Harborline. A fictional electricity utility serves its usage and bill data in the shape of NAESB REQ.21 ESPI, which is the standard behind Green Button™ data, and the agent reads it with a native adapter.

## Decisions

| Decision | Choice |
|---|---|
| Company | **Fernwick Power & Light** (fictional). App `apps/fernwick`, local `http://fernwick.localhost:4500`, production `energy-demo.poppylab.dev`. Can be renamed. |
| Extension | `poppylab.dev/espi` v1, "ESPI-shaped (modelled on NAESB REQ.21 ESPI), not certified". |
| Trademark | "Green Button" never appears in a name, package, product, UI or feature. At most one mention in the docs, as an adjective with ™, with the ownership note ("GREEN BUTTON and the Green Button Logo are trademarks or registered trademarks owned by Departments of the U.S. Government and/or Green Button Alliance, Inc.") and "not certified by or affiliated with the Green Button Alliance". No logo, no "compatible", no "Connect My Data". |
| Licence | The ESPI XSDs are Apache-2.0 (granted by NAESB); element names, codes and URL patterns can be reused. The REQ.21 prose is copyrighted and paywalled: no text or tables from it (including authoritative function-block descriptions). Fixtures and data are our own; we don't copy XSDs or OpenESPI samples. |
| Format | Atom XML (`application/atom+xml`), namespaces `http://www.w3.org/2005/Atom`, `http://naesb.org/espi` and `http://naesb.org/espi/customer`. No JSON (there is no official one). |
| Client XML | A strict parser in `pap-client` for the subset we use, with no dependency: refuses `<!DOCTYPE`, entities other than the five predefined ones and processing instructions other than the XML declaration; bounded in size, depth and element count. |
| Writes | One change through the utility's own API with Operations v3: switch rate plan (flat ↔ time of use) with exact terms (plan, effective date, estimated monthly difference). The ESPI API only reads. |

## The extension (v1)

**Discovery:**

```json
"extensions": {
  "operations": [{ "version": "3" }],
  "poppylab.dev/espi": [{
    "version": "1",
    "espi_version": "4.0",
    "resource_endpoint": "https://energy-demo.poppylab.dev/espi/1_1/resource",
    "resources": ["UsagePoint", "MeterReading", "IntervalBlock", "ReadingType", "LocalTimeParameters", "UsageSummary", "Authorization"],
    "function_blocks": [1, 3, 4, 5, 12, 13, 15, 16]
  }]
}
```

`resource_endpoint` on the origin of `organization.domain`, with the same rules as FDX's `base_url`. `espi_version`, `resources` and `function_blocks` are informational.

**Scopes** (Poppy scopes, not ESPI's `FB=…` strings; the equivalent function blocks go in the description):

| Scope | Allows | Function blocks |
|---|---|---|
| `espi:usage` | Meters (UsagePoint), readings and hourly intervals with their cost | 1, 3, 4, 5, 12, 13 |
| `espi:summary` | Bill summaries (UsageSummary) with costs | 15, 16 |
| `espi:customer` | Name and service address (RetailCustomer, PII) | 51, 53, 54, 55 |

All with `scope_hints` `{ "changes": "none", "personal_data": true }`.

**Consent and resources:** the consent page lets the User pick meters (UsagePoints), all ticked by default, using the gateway's `selectResources` mechanism already used by FDX. Without a meter, approving `espi:*` is refused. The choice applies to the whole grant, own API included (the same rule as Harborline after today's fix).

**Subscription and Authorization:** the subscription is the grant: `Subscription/{grantId}`. The token response adds the ESPI fields `resourceURI` (`…/Batch/Subscription/{grantId}`) and `authorizationURI` (`…/Authorization/{grantId}`), via the gateway's `tokenFields`, on sign-in and refresh.

**Routes** (under `resource_endpoint`, all `GET` except revocation; all require declaring the extension, `extension_required` otherwise):

| Route | Scope | Answers |
|---|---|---|
| `Batch/Subscription/{sub}` | `espi:usage` | Atom feed with every chosen UsagePoint and what hangs off it (MeterReading, ReadingType, IntervalBlock in the window, LocalTimeParameters; UsageSummary only with `espi:summary`) |
| `Subscription/{sub}/UsagePoint` | `espi:usage` | Feed of chosen UsagePoints |
| `Subscription/{sub}/UsagePoint/{up}` | `espi:usage` | Entry |
| `Subscription/{sub}/UsagePoint/{up}/MeterReading` | `espi:usage` | Feed |
| `…/MeterReading/{mr}/IntervalBlock` | `espi:usage` | Feed of IntervalBlocks (one per day) in the window |
| `Subscription/{sub}/UsagePoint/{up}/UsageSummary` | `espi:summary` | Feed of bill summaries |

`espi:summary` alone can also read the UsagePoint routes and `LocalTimeParameters/{id}`, to put the bills in local dates (decided when integrating the client). `published-max` is exclusive on both sides.
| `ReadingType/{id}`, `LocalTimeParameters/{id}` | `espi:usage` | Entry |
| `Authorization/{sub}` | any token of that grant | Entry with `status` (1 active), `authorizedPeriod`, `scope`, `resourceURI`, `authorizationURI` |
| `DELETE Authorization/{sub}` | any token of that grant | `204`; revokes the grant (method chosen by us: ESPI says "update or delete", and the exact method is unconfirmed) |
| `Batch/RetailCustomer/{sub}` | `espi:customer` | Name and service address (customer namespace) |

Query: `published-min`, `published-max` (RFC 3339, the window of intervals and summaries; default the last 31 days, maximum 92), `max-results` (bounded), `start-index` (1-based). `{sub}` other than the token's grant, or a UsagePoint not chosen → `404` with no body detail (as OpenESPI does: not revealing whether it exists).

**Errors:** token errors stay OAuth/Poppy (`WWW-Authenticate`). Malformed parameters → `400` with a small JSON body of our own `{ "error": "invalid_parameter", "description": … }` (ESPI defines no error body; documented as Harborline-style lab-own).

**Data, units and time (per the XSD):**
- Two customers (Elena and Robin, as in the other Companies). Elena: home meter + EV charger meter. Robin: home meter with solar panels (a second MeterReading with `flowDirection` 19, exported).
- Hourly intervals (`intervalLength` 3600) for 92 days ending at "today", generated deterministically (a seed per meter: daily and seasonal curve, weekends, EV charging at night), never random.
- ReadingType: `uom` 72 (Wh), `powerOfTenMultiplier` 0, `accumulationBehaviour` 4, `commodity` 1, `flowDirection` 1 or 19, `kind` 12, `currency` 840.
- `cost` and the summaries' amounts in hundred-thousandths of the currency ($12.34 → 1234000).
- `TimeType` in seconds since 1970 UTC; `DateTimeInterval` `{start, duration}`. LocalTimeParameters: Pacific time, `tzOffset` −28800, `dstOffset` 3600, US DST rules (bitmap encoded by us, with a test).
- Monthly bill summaries (closing on the 1st) from the intervals and the plan (flat: one price; time of use: three bands).

**Own API** (`/api/account/*`, OpenAPI, Operations v3): `account` (plan, address, meters), `bills` (simple JSON list), and `POST plan` (proposal → `approval_required` with exact terms → performed once). Scopes `account:read`, `plan:write`.

## Agent side

- `pap-core`: validated `poppylab.dev/espi` v1 entry in `CompanyProfile.extensions`, like FDX.
- `pap-client/src/xml.ts`: the strict parser. `pap-client/src/espi.ts`: native tools that **aggregate** before handing anything to the model (thousands of hourly intervals don't fit in context):
  - `espi_meters`: chosen UsagePoints with their kind (consumption/export), ReadingType decoded to readable units.
  - `espi_usage`: `{ usagePointId, from, to, granularity: "day" | "hour" }` → kWh and cost per day (or per hour for at most 3 days), totals, and the hours of highest consumption. Decodes `powerOfTenMultiplier`, `uom` and the hundred-thousandths.
  - `espi_bills`: bill summaries in kWh and currency.
  - `espi_authorization`: status and period of the subscription, using the `authorizationURI` the bank (utility) returned.
  - Bounds: response size, entries, intervals per call, depth; URLs only from the entry and the token response, validated against the origin; ids with the same rule as `validFdxId`.
- Playground: a generic toggle for "domain extension" (today "Use FDX"; for Fernwick "Use ESPI") without duplicating code; revocation from the account row (`DELETE` to the `authorizationURI`); "consumo", "factura", "usage", "bill" in demo mode; trace line in the Inspector.

## Phases

1. **Fernwick (Company):** app, data, own API with Operations, consent with meter selection, ESPI API in XML, Authorization and revocation, tests, `docs/fernwick-power.md`. Lab registration: `pap-core` (`lab.ts`, `index.ts` allowlist), `package.json` (`dev`, `dev:fernwick`), `scripts/scenarios.mjs` (`energy` group), `wrangler.toml` (`energy-demo.poppylab.dev`, without deploying).
2. **Client** (in parallel with 1, against this contract): `xml.ts`, `espi.ts`, hand-written fixtures, tests, `docs/openapi-tools.md`.
3. **Playground:** card for the new Company (visual change: tell the `poppy-21` session before merging), generic toggle, revocation, demo mode, end-to-end test against Fernwick in process, `PAP_ACCOUNT_ORIGINS` and `NEXT_PUBLIC_*` for production.
4. **Docs:** `docs/extensions/espi.md`, a second example in `docs/learn/extensions.md`, `coverage.md`, `scenario-lab.md`, README, index. The ™ mention and the note, once.
5. **Deploy** (with the user's OK): Fernwick creates the `energy-demo.poppylab.dev` domain; the playground with the new origin.

## Risks

- **Visual changes** to the playground (new card) while another session captures screenshots: warn before merging.
- **"How it works"** pages: the `poppy-ad` session is adding them to every Company; Fernwick won't have one until someone does.
- **Hand-written XML:** the parser must refuse anything outside the subset and is the most sensitive part; it gets more tests than the rest.
