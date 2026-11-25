# Fernwick Power & Light

Fernwick Power & Light (`apps/fernwick`) is a standalone, deployable, fully fictional Personal Agent Protocol 1.0 Company: an electricity utility that reads its meters every hour and bills on the 1st. It shows a second domain standard used through a Poppy extension, after Harborline's FDX-shaped API: its usage and bill data are served as Atom XML shaped after NAESB REQ.21 ESPI, through the `poppylab.dev/espi` extension ([the extension](extensions/espi.md)).

> **Safety notice:** no customer, meter, reading, plan or bill is real. Fernwick supplies, meters and bills no electricity. Never enter a real utility account number, address, password or bill.

The ESPI-shaped API is **ESPI-shaped (modelled on NAESB REQ.21 ESPI), not certified**. Element names, codes and URL patterns follow the ESPI schemas, which NAESB publishes under the Apache License 2.0. Every rule, description, title and piece of data here is Fernwick's own; no REQ.21 text or table, schema file or sample feed is in this repository. Fernwick is not certified by any ESPI certification programme; [the extension](extensions/espi.md) carries the trademark notice.

## Run it

```sh
pnpm dev:fernwick
# http://fernwick.localhost:4500
# customer portal: http://fernwick.localhost:4500/account
```

The package also has `dev:worker`, `build`, `test`, `typecheck` and `deploy` scripts. `wrangler.toml` deploys `FernwickCompany` to `energy-demo.poppylab.dev` (a custom domain) with visitor isolation and SQLite-backed Durable Object storage, like Harborline. It hasn't been deployed. `http://fernwick.localhost:4500` is in `LOCAL_COMPANY_ORIGINS` (`pap-core`), the exact origins allowed plain HTTP in development.

## Customers, meters and plans

- **Elena Maren**, 41 Bracken Row: a home meter (`UP-E1`, flat rate) and an EV charger meter (`UP-E2`, time of use).
- **Robin Ito**, 7 Sorrel Court: a home meter with solar panels (`UP-R1`, time of use) with two readings: energy delivered (`MR-R1`, `flowDirection` 1) and energy sent to the grid (`MR-R2`, `flowDirection` 19).

The town is Fernwick and the postal code `00000`, both invented. A plan belongs to a meter: every meter has its own, and a plan change is for one meter.

| Plan         | Hours (Pacific time)                                           | Price per kWh   |
| ------------ | -------------------------------------------------------------- | --------------- |
| Flat rate    | All hours                                                      | 24¢             |
| Time of use  | Off-peak 21:00–07:00 · mid-peak 07:00–16:00 · peak 16:00–21:00 | 17¢ · 25¢ · 41¢ |
| Solar credit | Energy sent to the grid, on either plan                        | 7¢              |

A bill also has a basic service charge per meter: USD 11.50 for a home, USD 4.00 for the EV charger.

## How the data is made

Nothing about usage is stored. `curves.ts` computes each hour's watt-hours as a pure function of the meter's seed and the hour, so an hour always reads the same, whatever the day of the request, on every visitor's copy. The variation comes from an integer hash of (seed, hour) and (seed, day), never `Math.random`:

- a home has a night base load, morning and evening peaks, more at midday at weekends, more in winter, and air conditioning on summer afternoons;
- the EV charger draws 7.2 kW from 22:00, 23:00 or midnight on three nights in four on weekdays and one in two at weekends, until 9 to 26 kWh are in;
- Robin's 5.6 kW panels produce around local noon, more in summer and less on cloudy days; the home takes from the grid what they don't cover and sends the surplus back.

The history is the 92 UTC days ending today, up to the last completed hour. Days and billing months are UTC; local time (Pacific, with US daylight saving) shapes the curves and the time-of-use bands. `billing.ts` prices each hour with the plan in force at that hour: watt-hours times the band's price, in hundred-thousandths of a US dollar (24 per Wh is 24¢ per kWh), so every cost is an exact integer. A bill covers a UTC month, closes on the 1st and exists for every month wholly inside the history (two or three). Its lines are the service charge (`itemKind` 2), the energy per band (`itemKind` 3, the sum of that band's hourly costs) and any solar credit (`itemKind` 6, negative); each line's `rounding` brings it to whole cents, and the total is the sum of the rounded lines.

Responses are computed per request, which is cheap (a 92-day window is at most about 2,200 hours per reading). One IntervalBlock is about 6 KB; an IntervalBlock feed of the default 31 days about 190 KB; a whole batch about 370 KB for the default window and 1.1 MB for 92 days.

## Scopes

| Scope            | Allows                                                                                                                   | Hints                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| `account:read`   | Fernwick's own API: service address, chosen meters with their plans, bills                                               | none, personal       |
| `plan:write`     | Propose a plan switch for a chosen meter (with `account:read`)                                                           | reversible, personal |
| `espi:usage`     | ESPI-shaped: meters, readings, reading types, hourly intervals with cost, local time. Function blocks 1, 3, 4, 5, 12, 13 | none, personal       |
| `espi:summary`   | ESPI-shaped: bill summaries; also the usage points and local time. Function blocks 15, 16                                | none, personal       |
| `espi:customer`  | ESPI-shaped: name and service address. Function blocks 51, 53, 54, 55                                                    | none, personal       |
| `offline_access` | Keep the grant refreshable for 7 days; without it the grant ends with its first access token (`grantLifetime`)           | none                 |

These are Poppy scopes, not ESPI's `FB=…` scope strings; each description names the function blocks it covers in Fernwick's own words.

## Consent and the meter choice

Whenever a sign-in asks for a scope that reads or changes a meter (`account:read`, `plan:write`, `espi:usage`, `espi:summary`), the consent page (the lab's shared consent sheet, `consentSheetHtml` in `pap-core`, in Fernwick's look) lists each test customer's meters, all ticked by default, as `espi_meter_{id}` checkboxes. The customers are radio buttons (`account-elena`, `account-robin`), and CSS `form:has(#account-elena:checked)` shows only that person's meters and hides "Allow" while none is ticked, with no script (the consent CSP allows none). The server keeps only the chosen person's meters (`selectResources`); approving with no meter is turned down (`400 invalid_request`) rather than granted empty. `espi:customer` alone reads no meter and asks for none. `plan:write` has its own checkbox (`allow_plan_write`) and `offline_access` is off by default (`allow_offline`).

The choice limits the whole grant: the ESPI-shaped API, Fernwick's own API (account, bills and the plan switch) and the Company Agent see and act on the chosen meters only, and a meter outside it is answered as one that doesn't exist. A grant without a choice (only `espi:customer`) reaches no meter. The customer portal is the account holder signed in directly and always shows everything.

## Own API and the plan change

`/openapi.json` describes Fernwick's own API, under `/api/account`:

- `GET /api/account/account` (`account:read`): customer, service address, the chosen meters with their plan and any `scheduled_change`, the plans' bands in cents per kWh, the solar credit.
- `GET /api/account/bills` (`account:read`): closed bills of the chosen meters, newest first, with lines and totals in whole cents.
- `POST /api/account/plan` (`account:read plan:write`): `{ usage_point_id, plan, idempotency_key }`, Operations v3.

The first request returns `403 approval_required` with exact terms: the meter, `from_plan` and `to_plan`, `effective_date` (the 1st of next month, the next bill cycle), `estimate_basis_month` and its kWh, `billed_cents`, `on_new_plan_cents` and `estimated_monthly_difference_cents` (the last closed bill priced both ways), `meter_version` and the key. An approved retry schedules the change once; nothing changes before the effective date, when the meter's plan history takes the new plan. Idempotency follows Harborline's: the gateway's operation reserves the key while it can be approved, a performed key is answered by its change with no new approval, and a key reused for another request is `409 idempotency_conflict`. Other errors are `plan_unchanged`, `change_already_scheduled`, `meter_not_found` and `invalid_plan_change`. An approval made stale by another switch performs nothing. A switch can be undone with another switch from the following cycle.

## ESPI-shaped API

Discovery lists the extension and no second API: the ESPI-shaped API is XML, so there is no OpenAPI document for it.

```json
"poppylab.dev/espi": [{
  "version": "1",
  "espi_version": "4.0",
  "resource_endpoint": "https://energy-demo.poppylab.dev/espi/1_1/resource",
  "resources": ["UsagePoint", "MeterReading", "IntervalBlock", "ReadingType", "LocalTimeParameters", "UsageSummary", "Authorization", "RetailCustomer"],
  "function_blocks": [1, 3, 4, 5, 12, 13, 15, 16, 51, 53, 54, 55]
}]
```

`resource_endpoint` is on the origin of `organization.domain`; `espi_version`, `resources` and `function_blocks` are informational. Every route under `/espi/` needs `Poppy-Extensions: "poppylab.dev/espi";v="1"`; without it the gateway answers `403 extension_required` before looking at the token (§3.3). The account prefixes are `/api/account` and `/espi/1_1/resource` (§7).

**The subscription is the grant.** `{sub}` is the grant's ID. Every token response of a grant with an `espi:*` scope, at sign-in and at every refresh, adds `resourceURI` (`…/Batch/Subscription/{sub}`) and `authorizationURI` (`…/Authorization/{sub}`), through the gateway's `tokenFields`, which now also gets the deployment's origin for absolute URLs.

| Route (under `resource_endpoint`, GET unless said)                                                    | Scope                          | Answers                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Batch/Subscription/{sub}`                                                                            | `espi:usage`                   | Feed: each chosen UsagePoint, LocalTimeParameters once, its MeterReadings, their ReadingTypes once each, IntervalBlocks in the window, and UsageSummaries in the window with `espi:summary` |
| `Subscription/{sub}/UsagePoint`, `…/UsagePoint/{up}`                                                  | `espi:usage` or `espi:summary` | Feed of the chosen meters; one entry                                                                                                                                                        |
| `…/UsagePoint/{up}/MeterReading`, `…/MeterReading/{mr}`                                               | `espi:usage`                   | Feed; one entry                                                                                                                                                                             |
| `…/MeterReading/{mr}/IntervalBlock`, `…/IntervalBlock/{YYYY-MM-DD}`                                   | `espi:usage`                   | Feed of one block per UTC day in the window; one day                                                                                                                                        |
| `…/UsagePoint/{up}/UsageSummary`, `…/UsageSummary/{YYYY-MM}`                                          | `espi:summary`                 | Feed of bill summaries in the window; one month                                                                                                                                             |
| `ReadingType`, `ReadingType/{id}`                                                                     | `espi:usage`                   | The reading types of the chosen meters                                                                                                                                                      |
| `LocalTimeParameters`, `LocalTimeParameters/LTP-PACIFIC`                                              | `espi:usage` or `espi:summary` | Pacific time                                                                                                                                                                                |
| `Authorization`, `Authorization/{sub}`                                                                | any token of the grant         | The grant as an Authorization                                                                                                                                                               |
| `DELETE Authorization/{sub}`                                                                          | any token of the grant         | `204`; revokes the grant                                                                                                                                                                    |
| `Batch/RetailCustomer/{sub}`, `RetailCustomer/{sub}/Customer`, `RetailCustomer/{sub}/ServiceLocation` | `espi:customer`                | Name (`Customer`) and service address (`ServiceLocation`), customer namespace                                                                                                               |

The plan's route table is served as written, plus the entry and feed routes that the entries' `self` and `up` links name, so every link resolves. `espi:summary` alone reads the usage point and local time routes so a client can put bills in local dates; readings, reading types and intervals stay `espi:usage`.

**Documents.** `Content-Type: application/atom+xml`, UTF-8, `Cache-Control: no-store`. A feed is `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:espi="http://naesb.org/espi">` (the customer feed declares `xmlns:cust="http://naesb.org/espi/customer"` instead) with `id`, `title`, `updated` (its newest entry's), a `rights` element with the fiction notice and "ESPI-shaped (modelled on NAESB REQ.21 ESPI), not certified", a `self` link, and its entries; no `author` and no feed-level `published`, as ESPI feeds. A single resource is an `<entry>` document. Each entry has `id` (`urn:uuid:` from a SHA-256 of what it describes, so it never changes), `title`, `published`, `updated`, links (`self`, `up`, and `related` where useful) whose `type` names the resource (`espi-entry/UsagePoint`, `espi-feed/MeterReading`…), and a bare `<content>` whose one child is the ESPI object. A UsagePoint links to its MeterReading and UsageSummary feeds and to `LocalTimeParameters/LTP-PACIFIC`; a MeterReading to `ReadingType/{id}` and its IntervalBlock feed. Child elements follow the schemas' order.

An abridged IntervalBlock entry:

```xml
<entry>
  <id>urn:uuid:484270ba-0d32-5640-bd0d-3a2269563c9a</id>
  <title>Hourly readings for 2026-11-20 (UTC)</title>
  <published>2026-11-20T00:00:00Z</published>
  <updated>2026-11-21T00:00:00Z</updated>
  <link href="…/Subscription/{sub}/UsagePoint/UP-R1/MeterReading/MR-R1/IntervalBlock/2026-11-20" rel="self" type="espi-entry/IntervalBlock"/>
  <link href="…/Subscription/{sub}/UsagePoint/UP-R1/MeterReading/MR-R1/IntervalBlock" rel="up" type="espi-feed/IntervalBlock"/>
  <content><espi:IntervalBlock>
    <espi:interval><espi:duration>86400</espi:duration><espi:start>1795132800</espi:start></espi:interval>
    <espi:IntervalReading>
      <espi:cost>9594</espi:cost>
      <espi:timePeriod><espi:duration>3600</espi:duration><espi:start>1795132800</espi:start></espi:timePeriod>
      <espi:value>234</espi:value>
      <espi:tou>3</espi:tou>
    </espi:IntervalReading>
    …
  </espi:IntervalBlock></content>
</entry>
```

(Served without indentation.)

**Units and time.** ReadingType: `accumulationBehaviour` 4, `commodity` 1, `currency` 840, `flowDirection` 1 or 19, `intervalLength` 3600, `kind` 12, `powerOfTenMultiplier` 0, `uom` 72 (Wh). A UsagePoint has `ServiceCategory/kind` 0 (electricity) and `status` 1. `value` is whole Wh; `cost` is in hundred-thousandths of a US dollar (USD 12.34 is 1234000): for delivered energy what the hour costs, for energy sent to the grid the credit it earns. `tou` (1 off-peak, 2 mid-peak, 3 peak) appears only on delivered hours of a time-of-use plan. Times are `TimeType`, whole seconds since 1970 UTC, and intervals are `DateTimeInterval` `{duration, start}`. Today's block holds the hours that have ended. LocalTimeParameters: `tzOffset` −28800, `dstOffset` 3600, `dstStartRule` `360E2000` and `dstEndRule` `B40E2000`. The rules are ESPI's 32-bit bitmap, encoded by `time.ts` (seconds in bits 0–11, hours 12–16, weekday 17–19 with Monday 1, day of month 20–24, operator 25–27, month 28–31): the second Sunday of March and the first Sunday of November, at 02:00, the start read in standard time and the end in daylight time. Fernwick uses the same decoder to compute local time, and `data.test.ts` checks both encodings and the 2026 and 2027 changes.

A UsageSummary has `billingPeriod`, `billLastPeriod`, a `costAdditionalDetailLastPeriod` line item per bill line (`amount`, `rounding`, `note`, `measurement` in Wh for energy, `itemKind`, `unitCost` per kWh, `itemPeriod`), `currency`, `overallConsumptionLastPeriod` (Wh delivered), `statusTimeStamp` (the closing), `commodity` and `tariffProfile` (the plan's name). The Authorization has `authorizedPeriod` (from the consent to the grant's end), `publishedPeriod` (the history available), `status` 1 (only a live grant's token gets there), `expires_at` (the grant's end), `scope` (the grant's Poppy scopes), `token_type` `DPoP` (outside the schema's list, which has only Bearer, because the tokens are DPoP-bound), `resourceURI`, `authorizationURI` and, with `espi:customer`, `customerResourceURI`.

**Window and paging.** `published-min` and `published-max` are RFC 3339 date-times and make the window `[min, max)`: an IntervalBlock or a UsageSummary is in it when its interval (the UTC day, the billing month) overlaps it, so every hour in the window comes with its block and one starting at `max` is out. By default the window is today and the 30 UTC days before; at most 92 days, and an hour more, so that 92 Pacific days across the November clock change fit. `max-results` (from 1; above 1000 is read as 1000) and `start-index` (from 1) page any feed's entries.

**Errors.** A `{sub}` other than the token's grant, a meter not chosen, another customer's resource or an unknown path is `404` with an empty body, never saying whether it exists. A malformed parameter is `400` with Fernwick's own JSON body, `{ "error": "invalid_parameter", "description": "…" }`, since ESPI defines no error body. Session and token errors stay Poppy and OAuth errors from the gateway (`invalid_session`, `extension_required`, `WWW-Authenticate` challenges, `insufficient_scope`).

**Revocation.** `DELETE Authorization/{sub}` with any token of the grant ends the grant, its access tokens and its refresh token (§4.6), on both APIs, and answers `204`. The method is Fernwick's choice: ESPI speaks of updating or deleting the Authorization without settling the method. Disconnecting the agent in the customer portal does the same.

## Conversations and tasks

`/poppy/conversations` exposes a deterministic Company Agent (`src/agent.ts`). Structured `data.request` values: `help`, `usage_this_month` (kWh delivered and sent to the grid and the energy cost so far, per chosen meter), `last_bill`, and `change_plan` (`usage_point_id`, `plan`), the same proposal as the own API, approved in the conversation (Operations v3). It keeps to the meters chosen at consent through `ConversationTurn.resources`. Handoff returns a fictional-demo response.

`/poppy/tasks` excludes starting, stopping or moving service, paying bills, outage and hazard reports, and downloading usage as a file (with the ESPI-shaped API as the alternative).

## Website

A landing page with the last week and the last bill of a sample meter and the plans, `/for-agents` with endpoints, ESPI routes, customers and scopes, and the customer portal (`/account`): meters and this month, the last seven days, bills, agent activity, feedback reports and connected agents, refreshed every two seconds. `/how-it-works` shows, with the shared generator in `pap-core` (`how-it-works.ts`), the three steps as the site serves them: the discovery document, the own API's operations, and Elena's EV charger switching to the flat rate, priced on the last closed bill as the switch's terms price it; its questions say what the ESPI shape is and what is excluded. `src/how-it-works.test.ts` checks it against the served objects.

## In the playground

Fernwick is the fifth card in the playground (**Fernwick Power & Light**, Utility), with "How much electricity did my EV use last week?" and "my bills" among its suggestions and "Switch my EV charger to the flat rate." as its change. Its account row has **Use ESPI**, the switch Harborline has as **Use FDX** ([Use ESPI](openapi-tools.md#use-espi)):

- With it on, Iris declares `poppylab.dev/espi` v1 in a new Session, asks at sign-in for `espi:usage` and `espi:summary` besides Fernwick's read scopes, keeps `resourceURI` and `authorizationURI` from the token response when they fit the entry, and offers four ESPI-shaped read tools that add up the hourly intervals before the model sees them. Fernwick's own API stays offered, with the meters chosen at consent applying to both.
- The account row shows the subscription, its status, shared meters and expiry, with **Revoke ESPI access**, which sends `DELETE Authorization/{sub}` and signs the conversation out on `204`.
- In demo mode, words about usage ("usage", "use", "consumo", "consumido", "energía", "kWh") read each shared meter's last seven days, and words about bills or money paid ("bill", "factura", "recibo", "paid", "pagué") its bills, matched by word stem ([the rules](openapi-tools.md#use-espi)).

The playground trusts `https://energy-demo.poppylab.dev` for sign-in and proposals (`PAP_ACCOUNT_ORIGINS` in its `wrangler.toml`) and builds its card with `NEXT_PUBLIC_FERNWICK_URL`, ready for the deployment.

## Tests and scenarios

```sh
pnpm --filter @poppy-lab/fernwick test
pnpm scenarios energy
```

- `src/data.test.ts`: the DST bitmap (both rules, a round trip, the schema's example, bounds) and the transitions in 2026 and 2027, the operators for "last" and "on or after"; curves without randomness, EV charging at night and solar export around noon; band prices; each bill line from its hours and rounded to the cent; which months close.
- `src/espi.test.ts`: discovery and scope descriptions, no forbidden names; `extension_required` before the token; consent with meters per person, refusal with none and with another person's meter; `resourceURI` and `authorizationURI` at sign-in and refresh; the batch, every route's XML (parsed by the test-only `xml-test.ts`), namespaces, links that resolve, units, `tou` and costs; identical bytes for the same request and the same hours on another day (fake timers); a bill summary added up from the IntervalBlocks the API serves; the window, offsets, paging and every `invalid_parameter`; bare 404s; scopes per route, `espi:summary` alone; the Authorization entry and `DELETE` revoking tokens and refresh.
- `src/fernwick.test.ts`: discovery, OpenAPI and pages; consent subsets; the meter choice on the own API; bills; the plan switch: `approval_required` with exact terms, performed once, replay, the same request again, `idempotency_conflict`, `change_already_scheduled`, `plan_unchanged`, `meter_not_found`, Operations v3 required, a stale approval.
- `src/conversations.test.ts`: help and sign-in events, the meter choice in the Company Agent, the plan change approved in a conversation, and the portal showing it and disconnecting the agent.
- `src/how-it-works.test.ts`: the How it works page against the served discovery document, OpenAPI and tasks, and the example switch against the seeded meter's last bill on both plans.
- In the playground, `lib/espi-fernwick.test.ts` checks the client's ESPI-shaped tools against Fernwick's own hours and bills, and `lib/use-espi-fernwick.test.ts` runs Iris with Use ESPI against this app in process ([Use ESPI](openapi-tools.md#use-espi)).
