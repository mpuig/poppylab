# ESPI: energy data through Poppy

Elena Maren is a customer of
[Fernwick Power & Light](https://energy-demo.poppylab.dev), an electricity
utility and one of Poppy Lab's fictional Companies. Her electric-vehicle
charger has a meter of its own. She asks Iris, a Personal Agent, how much
electricity the charger used last week and what her bills say, and she shares
that meter and not her home meter. Fernwick answers from hourly readings and
bills shaped like NAESB REQ.21 ESPI, which it lists as the extension
`poppylab.dev/espi` v1.

This page follows that request, one request at a time, for implementers.
[FDX: bank data through Poppy](fdx.md) follows the same pattern with JSON.

The traffic is from 25 November 2026. The discovery document comes from the
live site. The signed-in steps come from the same Fernwick code run in-process,
because they need a fictional customer's consent. URLs are shown as the live
ones, tokens are redacted and long values are trimmed with `…`.

> **ESPI-shaped (modelled on NAESB REQ.21 ESPI), not certified.** The ESPI
> schemas are Apache-2.0, so Fernwick reuses their element names and codes. The
> REQ.21 text is NAESB's, and none of it is here.

## Who does what

| Who                   | What they do in this process                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Elena, the user       | Signs in on Fernwick's page, chooses which meters to share and revokes the access from the agent when she wants to.                       |
| Iris, the agent       | Declares the extension, reads the meter's feeds, adds up the hourly intervals and keeps the subscription that arrives with the token.     |
| Fernwick, the Company | Lists the extension, asks Elena which meters to share, serves the feeds of those meters and no others, and ends the access when she asks. |

## Which request carries what

The model sees none of the credentials. Each request below carries a different
mix:

| Step | Request                                        | Session header | Access token | Who decides                |
| ---- | ---------------------------------------------- | -------------- | ------------ | -------------------------- |
| 1    | `GET /.well-known/poppy.json`                  | no             | no           |                            |
| 2    | any `/espi/1_1/resource/...`, undeclared       | yes            | yes          |                            |
| 3    | `POST /oauth/par`, consent                     | no             | no           | **the user**, at Fernwick  |
| 4    | `POST /oauth/token`                            | no             | no           |                            |
| 5    | `GET …/UsagePoint`                             | yes            | yes          |                            |
| 6    | `GET …/IntervalBlock`                          | yes            | yes          |                            |
| 7    | `GET …/UsageSummary`                           | yes            | yes          |                            |
| 8    | a meter the user didn't share                  | yes            | yes          |                            |
| 9    | `DELETE /espi/1_1/resource/Authorization/{id}` | yes            | yes          | **the user**, in the agent |

## 1. The utility lists the extension

```http
GET https://energy-demo.poppylab.dev/.well-known/poppy.json
```

```json
{
  "auth": {
    "scopes": {
      "account:read": "…",
      "plan:write": "…",
      "espi:usage": "…",
      "espi:summary": "…",
      "espi:customer": "…",
      "offline_access": "…"
    },
    "scope_hints": {
      "espi:usage": { "changes": "none", "personal_data": true },
      "espi:summary": { "changes": "none", "personal_data": true },
      "espi:customer": { "changes": "none", "personal_data": true }
    }
  },
  "apis": [
    {
      "type": "openapi",
      "url": "https://energy-demo.poppylab.dev/openapi.json",
      "description": "…"
    }
  ],
  "extensions": {
    "operations": [{ "version": "3" }],
    "poppylab.dev/espi": [
      {
        "version": "1",
        "espi_version": "4.0",
        "resource_endpoint": "https://energy-demo.poppylab.dev/espi/1_1/resource",
        "resources": [
          "UsagePoint",
          "MeterReading",
          "IntervalBlock",
          "ReadingType",
          "LocalTimeParameters",
          "UsageSummary",
          "Authorization",
          "RetailCustomer"
        ],
        "function_blocks": [1, 3, 4, 5, 12, 13, 15, 16, 51, 53, 54, 55]
      }
    ]
  }
}
```

- **The name carries a domain.** Names without one are reserved for extensions
  defined with the protocol, so anyone else's extension starts with a domain
  they control
  ([§3.3](https://personalagentprotocol.org/docs/1.0/spec#extensions)).
- **The agent checks the entry before using it.** `resource_endpoint` must be
  an HTTPS URL on `organization.domain`, with no credentials, query or
  fragment. An entry that fails counts as not listed, and the Inspector says
  why. `espi_version`, `resources` and `function_blocks` are informational.
- **There is no OpenAPI description of the ESPI-shaped API.** `apis` lists only
  Fernwick's own API. ESPI serves Atom XML, so the entry under `extensions` is
  the one place that says the API exists and where it is.
- **Each scope has hints.** The three `espi:` scopes read, and what they read is
  personal
  ([§4.7](https://personalagentprotocol.org/docs/1.0/spec#scopes)). Their
  descriptions, trimmed here, name the ESPI function blocks each covers in
  Fernwick's own words: blocks 1, 3, 4, 5, 12 and 13 for `espi:usage`, 15 and 16
  for `espi:summary`, and 51, 53, 54 and 55 for `espi:customer`.

## 2. Declare the extension, or be refused

The agent declares the extension on every request of the Session, next to
Operations
([§3.4](https://personalagentprotocol.org/docs/1.0/spec#versions)). This
request reads the utility's local-time rules:

```http
GET https://energy-demo.poppylab.dev/espi/1_1/resource/LocalTimeParameters/LTP-PACIFIC
Poppy-Session: eyJ0eXAiOiJwb3BweS1zZXNzaW9uK2p3dCIs…
Poppy-Version: 1.0
Poppy-Extensions: "operations";v="3", "poppylab.dev/espi";v="1"
Authorization: DPoP …
DPoP: …
```

Without the declaration, Fernwick refuses before it looks at the token:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{ "error": "extension_required", "extension": "poppylab.dev/espi" }
```

The order matters. Only a new Session that declares the extension can fix this,
so a refresh, a DPoP nonce retry or a fresh sign-in in front of it would be
wasted, and a refused request shouldn't touch any grant or Session. In Iris,
turning **Use ESPI** on or off starts a new Session for the same reason.

## 3. Sign in and choose the meters

The sign-in is Poppy's usual Direct Sign-In with PAR, PKCE and DPoP
([§4.2](https://personalagentprotocol.org/docs/1.0/spec#direct-sign-in)). Only
the scopes and the consent page change. Iris asks for the scopes its ESPI tools
use, `espi:usage` and `espi:summary`, besides Fernwick's own `account:read`. It
never asks for `espi:customer`, the customer's name and service address,
because it has no tool that reads them.

Fernwick's consent page adds a "Meters to share" list under the test customers.
Elena's two meters are ticked by default: Home, on a flat rate, and EV charger,
on time of use. She unticks Home. Approving with no meter ticked is turned down
(`400 invalid_request`) rather than granted empty.

The choice holds for the whole grant. Fernwick's own API and its Company Agent
see the EV charger only.

## 4. The token carries the subscription

```json
{
  "access_token": "…",
  "token_type": "DPoP",
  "expires_in": 3600,
  "refresh_token": "…",
  "scope": "account:read espi:usage espi:summary",
  "resourceURI": "https://energy-demo.poppylab.dev/espi/1_1/resource/Batch/Subscription/_mY5zLlQUROTfgo7jufBY2oPhKe6RHZp",
  "authorizationURI": "https://energy-demo.poppylab.dev/espi/1_1/resource/Authorization/_mY5zLlQUROTfgo7jufBY2oPhKe6RHZp"
}
```

In ESPI a third party reads a customer's data through a subscription and
manages it through an authorization. Here both are the Poppy grant, and the ID
at the end of each URI is the grant's ID. Every token response of the grant
carries the two fields, at the code exchange and at every refresh. Other agents
ignore a field they don't know (RFC 6749 §5.1).

Iris keeps a URI only when it is exactly
`{resource_endpoint}/Batch/Subscription/{id}` or
`{resource_endpoint}/Authorization/{id}`. It builds every other URL from the
entry, so the model never names a URL or an ID.

## 5. Find the meter

```http
GET https://energy-demo.poppylab.dev/espi/1_1/resource/Subscription/_mY5zLlQUROTfgo7jufBY2oPhKe6RHZp/UsagePoint
```

```xml
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:espi="http://naesb.org/espi">
  <id>urn:uuid:a21a61cf-19e6-59bd-8aad-697fc5869b22</id>
  <title>Usage points</title>
  <link href="…/UsagePoint" rel="self" type="espi-feed/UsagePoint"/>
  <entry>
    <id>urn:uuid:e00ed4b4-d41c-5ff1-bd23-74e108f4c65c</id>
    <title>EV charger</title>
    <link href="…/UsagePoint/UP-E2" rel="self" type="espi-entry/UsagePoint"/>
    <link href="…/UsagePoint/UP-E2/MeterReading" rel="related" type="espi-feed/MeterReading"/>
    <link href="…/UsagePoint/UP-E2/UsageSummary" rel="related" type="espi-feed/UsageSummary"/>
    <link href="…/LocalTimeParameters/LTP-PACIFIC" rel="related" type="espi-entry/LocalTimeParameters"/>
    <content>
      <espi:UsagePoint>
        <espi:ServiceCategory><espi:kind>0</espi:kind></espi:ServiceCategory>
        <espi:status>1</espi:status>
      </espi:UsagePoint>
    </content>
  </entry>
</feed>
```

The answer is an Atom feed, served as `application/atom+xml`. It is indented
and trimmed here: Fernwick serves it without indentation, with `rights`,
`updated` and dates besides. Each entry has an `id`, a `title`, links and a
`<content>` whose one child is the ESPI object.

Only the EV charger is listed. The `related` links tell the agent where the
meter's readings, bills and local time are. A reading links to a ReadingType
that says what it measures: `uom` 72 is watt-hours, `intervalLength` 3600 is an
hour and `currency` 840 is US dollars.

## 6. Read last week's usage

Elena asks for last week. The model calls Iris's `espi_usage` tool with local
dates:

```json
{ "usagePointId": "UP-E2", "from": "2026-11-18", "to": "2026-11-24" }
```

The agent turns the dates into Pacific midnights, written in UTC, and asks for
the interval blocks in that window:

```http
GET https://energy-demo.poppylab.dev/espi/1_1/resource/Subscription/_mY5zLlQUROTfgo7jufBY2oPhKe6RHZp/UsagePoint/UP-E2/MeterReading/MR-E2/IntervalBlock?published-min=2026-11-18T08%3A00%3A00Z&published-max=2026-11-25T08%3A00%3A00Z&start-index=1&max-results=31
```

Fernwick answers a feed with one `IntervalBlock` entry for each UTC day that
overlaps the window. This is the entry for 20 November, trimmed to two of its
24 readings:

```xml
<entry>
  <title>Hourly readings for 2026-11-20 (UTC)</title>
  <link href="…/MeterReading/MR-E2/IntervalBlock/2026-11-20" rel="self" type="espi-entry/IntervalBlock"/>
  <content>
    <espi:IntervalBlock>
      <espi:interval><espi:duration>86400</espi:duration><espi:start>1795132800</espi:start></espi:interval>
      …
      <espi:IntervalReading>
        <espi:cost>68</espi:cost>
        <espi:timePeriod><espi:duration>3600</espi:duration><espi:start>1795150800</espi:start></espi:timePeriod>
        <espi:value>4</espi:value>
        <espi:tou>1</espi:tou>
      </espi:IntervalReading>
      <espi:IntervalReading>
        <espi:cost>122400</espi:cost>
        <espi:timePeriod><espi:duration>3600</espi:duration><espi:start>1795154400</espi:start></espi:timePeriod>
        <espi:value>7200</espi:value>
        <espi:tou>1</espi:tou>
      </espi:IntervalReading>
      …
    </espi:IntervalBlock>
  </content>
</entry>
```

The charger drew 7,200 Wh in the hour that starts at 1795154400 seconds since
1970, which is 06:00 UTC and 22:00 on the 19th in Pacific time. `cost` is in
hundred-thousandths of a dollar, so 122400 is USD 1.224. `tou` 1 is off-peak.

The model sees none of this. A meter reports an interval every hour: 24
readings a day and 2,208 over the longest window of 92 days. The agent decodes
the units on the way. Values are watt-hours times a power of ten, costs are in
hundred-thousandths of a dollar and times are seconds since 1970.

The agent also puts days in the utility's local time, from the
`LocalTimeParameters` it read: a `tzOffset` of -28800, a `dstOffset` of 3600
and the rules `360E2000` and `B40E2000`. The tool answers in kWh and dollars
per local day, or per hour for at most three days, with the total and the hours
of highest use:

```json
{
  "usagePointId": "UP-E2",
  "from": "2026-11-18",
  "to": "2026-11-24",
  "granularity": "day",
  "timeZone": "UTC-08:00, UTC-07:00 in daylight time",
  "meterReadings": [
    {
      "meterReadingId": "MR-E2",
      "direction": "consumption",
      "unit": "kWh",
      "currency": "USD",
      "total": { "kWh": 81.513, "cost": 13.91, "intervals": 168 },
      "days": [
        { "date": "2026-11-18", "kWh": 20.986, "cost": 3.58 },
        { "date": "2026-11-19", "kWh": 21.802, "cost": 3.71 }
      ],
      "topHours": [
        { "start": "2026-11-18T00:00-08:00", "kWh": 7.2, "cost": 1.22 }
      ]
    }
  ],
  "truncated": false
}
```

The answer is trimmed to two of the seven days and the highest hour.

## 7. Read the bills

Fernwick bills on the 1st, for a UTC month. The tool `espi_bills` asks for the
bill summaries published in the last 92 days:

```http
GET https://energy-demo.poppylab.dev/espi/1_1/resource/Subscription/_mY5zLlQUROTfgo7jufBY2oPhKe6RHZp/UsagePoint/UP-E2/UsageSummary?published-min=2026-08-26T07%3A00%3A00Z&published-max=2026-11-26T08%3A00%3A00Z&start-index=1&max-results=31
```

Both ends are Pacific midnights: 07:00 UTC in August, in daylight time, and
08:00 UTC in November. The clock changed in between, so the window is 92 × 24
hours plus one, the most Fernwick accepts. This is the entry for October,
trimmed:

```xml
<entry>
  <title>EV charger: bill for October 2026</title>
  <link href="…/UsagePoint/UP-E2/UsageSummary/2026-10" rel="self" type="espi-entry/UsageSummary"/>
  <content>
    <espi:UsageSummary>
      <espi:billingPeriod><espi:duration>2678400</espi:duration><espi:start>1790812800</espi:start></espi:billingPeriod>
      <espi:billLastPeriod>8383000</espi:billLastPeriod>
      <espi:costAdditionalDetailLastPeriod>
        <espi:amount>400000</espi:amount>
        <espi:rounding>0</espi:rounding>
        <espi:note>Basic service charge</espi:note>
        <espi:itemKind>2</espi:itemKind>
        …
      </espi:costAdditionalDetailLastPeriod>
      …
      <espi:currency>840</espi:currency>
      <espi:overallConsumptionLastPeriod>
        <espi:powerOfTenMultiplier>0</espi:powerOfTenMultiplier>
        <espi:uom>72</espi:uom>
        <espi:value>468197</espi:value>
      </espi:overallConsumptionLastPeriod>
      <espi:statusTimeStamp>1793491200</espi:statusTimeStamp>
      <espi:tariffProfile>Time of use</espi:tariffProfile>
    </espi:UsageSummary>
  </content>
</entry>
```

`billLastPeriod` 8383000 is USD 83.83, and `overallConsumptionLastPeriod` is
468,197 Wh. The bill has one `costAdditionalDetailLastPeriod` for each line: the
service charge (`itemKind` 2) and the energy in each price band (`itemKind` 3).

The tool adds the lines up and answers in kWh and dollars. Fernwick closes its
bills at UTC midnight on the 1st, so the agent dates a bill's period in UTC.
In Pacific dates October would seem to start on 30 September.

```json
{
  "usagePointId": "UP-E2",
  "from": "2026-08-26",
  "to": "2026-11-25",
  "bills": [
    {
      "summaryId": "2026-10",
      "period": {
        "from": "2026-10-01",
        "to": "2026-10-31",
        "days": 31,
        "timeZone": "UTC"
      },
      "kWh": 468.197,
      "currency": "USD",
      "amount": 83.83,
      "lineItems": [
        { "note": "Basic service charge", "amount": 4 },
        { "note": "Energy, off-peak", "amount": 79.3 },
        { "note": "Energy, mid-peak", "amount": 0.28 },
        { "note": "Energy, peak", "amount": 0.25 }
      ],
      "tariff": "Time of use",
      "statusAt": "2026-11-01T00:00:00Z"
    }
  ],
  "truncated": false
}
```

The answer is trimmed to the October bill, and September's is the other.

## 8. Ask for a meter that wasn't shared

Elena's home meter is `UP-E1`. She didn't share it:

```http
GET https://energy-demo.poppylab.dev/espi/1_1/resource/Subscription/_mY5zLlQUROTfgo7jufBY2oPhKe6RHZp/UsagePoint/UP-E1
```

```http
HTTP/1.1 404 Not Found
```

The body is empty. Fernwick doesn't say whether the meter exists, and the same
answer covers another subscription's ID, another customer's resource and an
unknown path.

A malformed window parameter gets `400`. ESPI defines no error body, so the
body is Fernwick's own:

```http
GET https://energy-demo.poppylab.dev/espi/1_1/resource/Subscription/_mY5zLlQUROTfgo7jufBY2oPhKe6RHZp/UsagePoint/UP-E2/MeterReading/MR-E2/IntervalBlock?published-min=yesterday
```

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{ "error": "invalid_parameter", "description": "published-min must be an RFC 3339 date-time, such as 2026-11-01T00:00:00Z" }
```

These are the API's own errors, and they go to the model, bounded, as
`{ "error": "espi_error", "status": 404 }`. A bare `404` has no body to pass on,
so the model gets only the status.

Protocol errors never reach the model as ESPI ones: `invalid_session`,
`session_ended`, `extension_required`, `insufficient_scope` and token challenges
in `WWW-Authenticate` keep their own path. The transport tells them apart by the
known Poppy and OAuth codes and the challenge header, and for ESPI also by the
bare `404`.

## 9. Revoke the access

Revoking is Elena's action, not a tool the model has. Iris shows the
subscription in the account row: its status, the shared meters and its expiry.
The status comes from the Authorization at `authorizationURI`, which Iris reads
with its `espi_authorization` tool:

```json
{
  "authorizationId": "_mY5zLlQUROTfgo7jufBY2oPhKe6RHZp",
  "status": "active",
  "statusCode": 1,
  "expiresAt": "2026-11-26T00:30:00Z",
  "scope": "account:read espi:usage espi:summary",
  "subscriptionId": "_mY5zLlQUROTfgo7jufBY2oPhKe6RHZp"
}
```

The answer is trimmed to the grant's status, end and scope. This grant lasts one
hour, because it has no `offline_access`. The row also has a **Revoke ESPI
access** button that asks again in the page. Elena confirms, and Iris sends:

```http
DELETE https://energy-demo.poppylab.dev/espi/1_1/resource/Authorization/_mY5zLlQUROTfgo7jufBY2oPhKe6RHZp
```

```http
HTTP/1.1 204 No Content
```

That ends the grant, its access tokens and its refresh token, on the
ESPI-shaped API and on Fernwick's own API alike. The next request gets
`401 invalid_token`:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: DPoP error="invalid_token"
Content-Type: application/json

{ "error": "invalid_token" }
```

ESPI speaks of updating or deleting the authorization without settling the
method, so `DELETE` is the extension's own choice. Revoking the refresh token
([§4.6](https://personalagentprotocol.org/docs/1.0/spec#revocation)), or
disconnecting the agent in Fernwick's customer portal, ends the subscription the
same way. After the `204`, Iris signs the conversation out.

## What Fernwick controls

Fernwick stays in charge of its own business throughout.

- It decides which scopes exist, what each unlocks and what each changes. The
  three `espi:` scopes only read.
- The sign-in and the choice of meters happen on its own page. An approval with
  no meter is turned down.
- It applies the choice to the whole grant: the ESPI-shaped API, its own API and
  its Company Agent. A meter outside the choice doesn't exist for the agent.
- It decides what a day and a bill are. Days and billing months are UTC, and a
  window is the last 31 days unless the agent asks for more, up to 92 days and
  an hour.
- It ends the grant. Without `offline_access` the grant ends with its first
  access token. With it, the grant refreshes for 7 days.
- It keeps writes out of this API. A switch between its plans stays on its own
  API, with approval of the exact terms.

## For the technical reader

[Domain extensions](README.md) explains why an extension exists and what
changed between this example and the bank's.
[Write a domain extension](../write-an-extension.md) gives the steps to define
one. The contract is [`poppylab.dev/espi` v1](../../extensions/espi.md), and
Fernwick's side is in
[its design note](../../fernwick-power.md#espi-shaped-api).

To run it yourself, open the [playground](https://poppylab.dev/playground), pick
**Fernwick Power & Light**, turn **Use ESPI** on and sign in. Share the EV
charger, then ask how much electricity it used last week. The Inspector shows
each request with the scopes it used.
