# Extension draft: `poppylab.dev/espi` v1

**Status:** experimental, defined by Poppy Lab, not proposed upstream. Version `1`, read-only.

This extension lets an electricity utility that serves its usage and bill data in the shape of NAESB REQ.21 Energy Services Provider Interface (ESPI), the standard behind Green Button™ data[^gb], offer it to Personal Agents through Personal Agent Protocol 1.0. It is the second domain extension in the lab, after [`poppylab.dev/fdx`](fdx.md), and follows the same pattern: this protocol handles discovery, Personal Agent identity, the Session and sign-in, and the ESPI-shaped API carries the meter data. Fernwick Power & Light implements the Company side ([Fernwick](../fernwick-power.md#espi-shaped-api)), `packages/pap-client/src/espi.ts` the Personal Agent side ([OpenAPI tools](../openapi-tools.md#espi-shaped-apis-a-native-adapter)).

> **ESPI-shaped (modelled on NAESB REQ.21 ESPI), not certified.** Element names, codes and URL patterns follow the ESPI XML schemas, which NAESB publishes under the Apache License 2.0. The REQ.21 text itself is copyrighted and sold by NAESB: none of its prose or tables is reproduced here, the function-block descriptions included, and every rule, description and error text is Poppy Lab's own. No schema file or sample feed is in this repository. Fernwick is not certified by or affiliated with the Green Button Alliance.

[^gb]: GREEN BUTTON and the Green Button Logo are trademarks or registered trademarks owned by Departments of the U.S. Government and/or Green Button Alliance, Inc.

## Why an extension

ESPI has no OpenAPI description and no JSON: it serves Atom XML. A generic OpenAPI adapter can't read it at all, and a model couldn't read it either, since one meter reports an interval every hour. An extension says what a Personal Agent needs to use a native client instead:

- that the API follows a known shape, Atom feeds with ESPI elements, and where it is;
- scopes that mean the same at every utility, mapped to ESPI's function blocks;
- which meters the User chose to share, carried in the grant;
- the subscription and its authorization, tied to the Poppy grant's lifecycle.

## Discovery

The Company lists the extension in `poppy.json` (§3.3):

```json
"extensions": {
  "operations": [{ "version": "3" }],
  "poppylab.dev/espi": [
    {
      "version": "1",
      "espi_version": "4.0",
      "resource_endpoint": "https://energy-demo.poppylab.dev/espi/1_1/resource",
      "resources": ["UsagePoint", "MeterReading", "IntervalBlock", "ReadingType", "LocalTimeParameters", "UsageSummary", "Authorization", "RetailCustomer"],
      "function_blocks": [1, 3, 4, 5, 12, 13, 15, 16, 51, 53, 54, 55]
    }
  ]
}
```

| Field               | Req. | Meaning                                                                                                                  |
| ------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------ |
| `version`           | Yes  | `1`.                                                                                                                     |
| `resource_endpoint` | Yes  | Where the ESPI-shaped resources are. An HTTPS URL on `organization.domain`, with no credentials, query or fragment.      |
| `espi_version`      | No   | The ESPI release the shape follows. Informational.                                                                       |
| `resources`         | No   | The ESPI resource names served. Informational.                                                                           |
| `function_blocks`   | No   | The ESPI function block numbers the API covers. Informational: the scopes below are what an agent asks for and is given. |

A Personal Agent MUST treat an entry whose `resource_endpoint` is on another origin, uses another scheme, or carries credentials, a query or a fragment as not listed, and MUST NOT follow redirects from it (§3), as for FDX's `base_url`. The ESPI-shaped API has no entry in `apis`, because there is no OpenAPI description for it. A Company whose own API also lists ESPI-shaped paths should expect a Personal Agent with the extension to keep them out of its generic adapter.

## Declaring

A Personal Agent that uses the extension declares it on every request of the Session: `Poppy-Extensions: "poppylab.dev/espi";v="1"`, alongside any others (§3.4). The Company refuses requests under `resource_endpoint` that don't declare it with `403 {"error":"extension_required","extension":"poppylab.dev/espi"}` (§3.3), before looking at the access token. Iris declares it only while the User has **Use ESPI** on, and starts a new Session when that changes.

## Scopes

Poppy scopes, not ESPI's `FB=…` scope strings. Each is described in `auth.scopes`, names the function blocks it covers in the Company's own words, and is hinted as `{ "changes": "none", "personal_data": true }` (§4.7):

| Scope           | Allows                                                                                    | Function blocks    |
| --------------- | ----------------------------------------------------------------------------------------- | ------------------ |
| `espi:usage`    | The chosen meters (UsagePoints), their readings, reading types and hourly intervals, cost | 1, 3, 4, 5, 12, 13 |
| `espi:summary`  | Bill summaries (UsageSummary) of the chosen meters; also the meters and their local time  | 15, 16             |
| `espi:customer` | The customer's name and service address (RetailCustomer)                                  | 51, 53, 54, 55     |

`espi:summary` alone also reads the UsagePoint routes and `LocalTimeParameters`, so that a Personal Agent can place bills in local dates without reading intervals. The Company applies the scopes of the token in hand. A Personal Agent asks only for what its tools use: Iris asks for `espi:usage` and `espi:summary` and never `espi:customer`, for which it has no tool.

## Sign-in and the meter choice

- **Meters are chosen at consent.** When a sign-in requests a scope that reads a meter, the consent page lists the chosen customer's meters, all ticked by default. The grant records them (Fernwick uses the gateway's `selectResources`), and approving with no meter is turned down (`400 invalid_request`) rather than granted empty. `espi:customer` alone reads no meter and asks for none.
- **The choice holds for the whole grant.** The ESPI-shaped API, the Company's own API and its Company Agent see the chosen meters only, and a meter outside the choice is answered as one that doesn't exist. This is the rule Harborline follows for accounts.
- **Security.** Direct Sign-In only, with PKCE, `private_key_jwt` and DPoP-bound tokens, and PAR offered.

## The subscription is the grant

In ESPI, a third party reads a customer's data through a subscription and manages it through an authorization. Here both are the Poppy grant: `{sub}` is the grant's ID. Every token response of a grant with an `espi:*` scope, at the code exchange and at every refresh, carries ESPI's two fields:

```json
{
  "access_token": "…",
  "token_type": "DPoP",
  "refresh_token": "…",
  "scope": "account:read espi:usage espi:summary",
  "resourceURI": "https://energy-demo.poppylab.dev/espi/1_1/resource/Batch/Subscription/{sub}",
  "authorizationURI": "https://energy-demo.poppylab.dev/espi/1_1/resource/Authorization/{sub}"
}
```

Other Personal Agents ignore fields they don't know (RFC 6749 §5.1). A Personal Agent MUST keep a URI only when it is exactly `{resource_endpoint}/Batch/Subscription/{id}` or `{resource_endpoint}/Authorization/{id}`: the endpoint's origin, no credentials, query or fragment, and an id that is one plain path segment. It reads the subscription id from `resourceURI` and builds every other URL from the entry, and it reads and revokes the authorization only at `authorizationURI`. A sign-in replaces the kept URIs; a refresh that doesn't repeat them keeps them; sign-out forgets them.

## Resources

Relative to `resource_endpoint`, `GET` unless said:

| Route                                                       | Scope                          | Answers                                                                                           |
| ----------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `Batch/Subscription/{sub}`                                  | `espi:usage`                   | A feed of every chosen UsagePoint with what hangs off it; UsageSummaries only with `espi:summary` |
| `Subscription/{sub}/UsagePoint`, `…/UsagePoint/{up}`        | `espi:usage` or `espi:summary` | The chosen meters; one meter                                                                      |
| `…/UsagePoint/{up}/MeterReading`, `…/MeterReading/{mr}`     | `espi:usage`                   | Its readings; one reading                                                                         |
| `…/MeterReading/{mr}/IntervalBlock`, `…/IntervalBlock/{id}` | `espi:usage`                   | Interval blocks in the window; one block                                                          |
| `…/UsagePoint/{up}/UsageSummary`, `…/UsageSummary/{id}`     | `espi:summary`                 | Bill summaries in the window; one bill                                                            |
| `ReadingType/{id}`                                          | `espi:usage`                   | What a reading measures, and in which unit                                                        |
| `LocalTimeParameters/{id}`                                  | `espi:usage` or `espi:summary` | The meters' time zone and daylight saving rules                                                   |
| `Authorization/{sub}`                                       | any token of the grant         | The grant as an Authorization                                                                     |
| `DELETE Authorization/{sub}`                                | any token of the grant         | `204`; revokes the grant                                                                          |
| `Batch/RetailCustomer/{sub}`                                | `espi:customer`                | The customer's name and service address, in the customer namespace                                |

A Company MAY serve more of the ESPI route tree, such as the feed and entry routes its links name. Fernwick does, so every `self` and `up` link resolves.

**Window and paging.** `published-min` and `published-max` are RFC 3339 date-times and make a window `[min, max)`. An interval block or a bill summary is in it when its own interval overlaps it. Without them the Company picks a default; Fernwick takes the last 31 days, and at most 92 (with an hour more, so that 92 local days across the autumn clock change fit). `max-results` and `start-index` (from 1) page any feed's entries.

## Documents

`Content-Type: application/atom+xml`, UTF-8. A feed is an Atom `<feed>` in the namespace `http://www.w3.org/2005/Atom`, with the ESPI elements in `http://naesb.org/espi` (customer data in `http://naesb.org/espi/customer`). Each `<entry>` has `id`, `title`, `published`, `updated`, links whose `rel` is `self`, `up` or `related`, and a `<content>` whose one child is the ESPI object. A single resource is an `<entry>` document. A UsagePoint links to its MeterReading and UsageSummary feeds and to its LocalTimeParameters; a MeterReading to its ReadingType and its IntervalBlock feed. The document is personal data: the Company SHOULD send `Cache-Control: no-store`.

An abridged interval block:

```xml
<entry>
  <id>urn:uuid:484270ba-0d32-5640-bd0d-3a2269563c9a</id>
  <title>Hourly readings for 2026-11-20 (UTC)</title>
  <link href="…/Subscription/{sub}/UsagePoint/UP-E2/MeterReading/MR-E2/IntervalBlock/2026-11-20" rel="self" type="espi-entry/IntervalBlock"/>
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

A bill summary has `billingPeriod`, `billLastPeriod`, a `costAdditionalDetailLastPeriod` line per bill line, `currency`, `overallConsumptionLastPeriod`, `statusTimeStamp` and `tariffProfile`. The Authorization has `authorizedPeriod`, `publishedPeriod`, `status`, `expires_at`, `scope`, `resourceURI` and `authorizationURI`. It never carries a token here: ESPI's schema has room for `access_token` and `refresh_token` in an Authorization, and a Personal Agent MUST NOT pass them on if a Company sends them.

Responses are Company content (§10.1). A Personal Agent parses them with a strict parser that refuses document type declarations, entities other than the predefined five, and processing instructions, with bounds on size, depth and element count ([the parser](../openapi-tools.md#the-xml-parser)). It keeps only the elements it knows, bounds their text, follows a link only back under `resource_endpoint`, and drops an entry whose `self` link belongs to another subscription, meter or reading.

## Units and time

As the ESPI schemas define them:

- **ReadingType.** `uom` 72 is Wh; a value is `value` × 10^`powerOfTenMultiplier`. `accumulationBehaviour` 4 is a quantity per interval, `flowDirection` 1 energy delivered to the customer and 19 energy received from them (solar panels), `kind` 12 energy, `commodity` 1 electricity at the meter, `currency` 840 US dollars (ISO 4217 numeric), `intervalLength` 3600 an hour.
- **Money.** `cost` and the summaries' amounts are hundred-thousandths of the currency: USD 12.34 is `1234000`.
- **Time.** `TimeType` is whole seconds since 1970 UTC, and a `DateTimeInterval` is `{duration, start}`. `LocalTimeParameters` gives `tzOffset`, `dstOffset`, and `dstStartRule` and `dstEndRule`, 32-bit rule bitmaps for when daylight saving starts and ends. A local day can have 23 or 25 hours.
- **Volume.** One meter reading has 24 intervals a day, 2,208 over 92 days. A Personal Agent SHOULD add them up before a model sees them: Iris's `espi_usage` returns kWh and cost per local day (or per hour, for at most three days), the total and the hours of highest use, never a raw interval.

## Errors

| Situation                                                                       | Response                                                   |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Another subscription, a meter not chosen, another customer's resource, no route | `404` with an empty body                                   |
| A malformed `published-min`, `published-max`, `max-results` or `start-index`    | `400 { "error": "invalid_parameter", "description": "…" }` |

The Company never says whether a resource it won't show exists. ESPI defines no error body, so the `400` body is this extension's own, in the lab's usual shape. Session, version, extension and token errors stay the protocol's (§7): `invalid_session`, `session_ended`, `version_unsupported`, `extension_required`, `insufficient_scope`, and OAuth challenges in `WWW-Authenticate`.

A Personal Agent passes the API's own errors to its model, bounded (Iris's tools answer `{ "error": "espi_error", "status", "code"?, "description"? }`, and only `{ "error": "espi_error", "status": 404 }` for a bare 404), and keeps protocol errors on their own path. The transport tells them apart as for FDX: by the known Poppy and OAuth codes and by the challenge header, and here also by the bare 404, which has no body.

## Revocation

`DELETE {authorizationURI}` with any token of the grant ends the grant, its access tokens and its refresh token, on both APIs, and answers `204`. A Personal Agent that then gets `401 invalid_token` from that request knows the grant had already ended. Revoking the refresh token (§4.6), or disconnecting the agent at the Company, ends the subscription the same way. Revoking is the User's choice, like sign-out: a Personal Agent offers it in its own interface, not as a tool for its model. Iris shows the subscription in the chat's account row, its status, shared meters and expiry, with **Revoke ESPI access** ([Use ESPI](../openapi-tools.md#use-espi)).

ESPI speaks of updating or deleting the Authorization without settling the method, so `DELETE` is this extension's choice.

## Grant lifetime

The subscription lasts as long as the grant. A grant without `offline_access` ends with its first access token; with it, the grant is refreshable for the Company's grant lifetime, 7 days at Fernwick. `Authorization`'s `authorizedPeriod` and `expires_at` say when it ends, and its `status` is `1` (active), since only a live grant's token can read it.

## Not covered

- **Writes.** The ESPI-shaped API only reads. A plan switch stays on the Company's own API with Operations v3.
- **Other commodities and kinds.** Version 1 is electricity in Wh per interval. Gas, water, demand (W) and power quality readings are not defined; a Personal Agent skips a reading it can't add up and says so.
- **Third-party registration and notifications.** In ESPI a third party registers with the utility and is notified of new data. Here the Personal Agent's verified `client_id` (§4.1) is the only identity, and there are no notifications: the agent reads when asked.
- **Bulk and download-my-data files.** One customer's data, read through an agent, only.

## Open questions

- Whether a utility's bills close at local midnight or, as Fernwick's do, at UTC midnight. Iris gives a period that starts at UTC midnight in UTC dates, because in Pacific dates it would seem to start a day early; a real utility would bill in its own time zone.
- Whether `espi:summary` alone should read the usage points and local time, as here, or only the bills.
- Whether the scope names should follow ESPI's function-block scope strings instead of Poppy-style names.
- The Authorization's `token_type` is `DPoP`, outside the schema's list, because the tokens are DPoP-bound. Whether to leave the element out instead is open.
