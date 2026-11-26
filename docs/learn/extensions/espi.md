# ESPI: energy data through Poppy

Elena Maren is a customer of
[Fernwick Power & Light](https://energy-demo.poppylab.dev), an electricity
utility and one of Poppy Lab's fictional Companies. She asks Iris, a Personal
Agent, how much electricity her electric-vehicle charger used last week and what
her bills say, and shares the charger's meter and not her home meter. Fernwick
answers from hourly readings and bills shaped like NAESB REQ.21 ESPI, listed as
the extension `poppylab.dev/espi` v1.

The traffic is from 25 November 2026. The discovery document comes from the live
site, and the signed-in steps from the same Fernwick code run in-process,
because they need a fictional customer's consent. URLs are the live ones, and
tokens and long values are trimmed with `…`.

> **ESPI-shaped (modelled on NAESB REQ.21 ESPI), not certified.** The ESPI
> schemas are Apache-2.0, so Fernwick reuses their element names and codes. The
> REQ.21 text is NAESB's, and none of it is here.

## Who does what

| Who                   | What they do in this process                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| Elena, the user       | Signs in, chooses which meters to share and revokes the access.                                 |
| Iris, the agent       | Declares the extension, reads the feeds, adds up the intervals and keeps the subscription.      |
| Fernwick, the Company | Lists the extension, asks which meters to share, serves those only, ends the access on request. |

![The utility lists the extension poppylab.dev/espi in its poppy.json. The Personal Agent declares the extension on every request, and a request that does not is refused with extension_required. The user signs in on the utility's page and picks the meters to share, and the token the agent receives carries the subscription. The agent finds the meter, reads last week's usage and reads the bills, and only the shared meter is listed; asking for a meter that was not shared gets a 404, as if it did not exist. The user revokes the access in the agent, and the agent deletes the authorization at the utility.](../../../apps/playground/public/learn-media/diagrams/espi-sequence.svg "Nine steps of one request for energy data, laid out like the bank's, with the two things only the user does.")

## Which request carries what

The model sees none of the credentials.

| Request                                               | Session header | Access token | Who decides                |
| ----------------------------------------------------- | -------------- | ------------ | -------------------------- |
| `GET /.well-known/poppy.json`                         | no             | no           |                            |
| `POST /oauth/par`, consent, `POST /oauth/token`       | no             | no           | **the user**, at Fernwick  |
| any `/espi/1_1/resource/...` request, declared or not | yes            | yes          |                            |
| `DELETE /espi/1_1/resource/Authorization/{id}`        | yes            | yes          | **the user**, in the agent |

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

- **The name carries a domain.** Names without one are reserved for the
  protocol's own extensions
  ([§3.3](https://personalagentprotocol.org/docs/1.0/spec#extensions)).
- **The agent checks the entry before using it.** `resource_endpoint` must be an
  HTTPS URL on `organization.domain`, with no credentials, query or fragment. A
  failing entry counts as not listed, and the Inspector says why.
  `espi_version`, `resources` and `function_blocks` are informational.
- **There is no OpenAPI description of the ESPI-shaped API.** `apis` lists only
  Fernwick's own, and ESPI serves Atom XML, so the entry under `extensions` is
  the one place that says the API exists and where.
- **Each scope has hints.** The three `espi:` scopes read personal data
  ([§4.7](https://personalagentprotocol.org/docs/1.0/spec#scopes)). Their
  descriptions, trimmed here, name the ESPI function blocks each covers: blocks
  1, 3, 4, 5, 12 and 13 for `espi:usage`, 15 and 16 for `espi:summary`, and 51,
  53, 54 and 55 for `espi:customer`.

## 2. Declare the extension, or be refused

The agent declares the extension on every request of the Session, next to
Operations
([§3.4](https://personalagentprotocol.org/docs/1.0/spec#versions)). This one
reads the utility's local-time rules:

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

Only a new Session that declares the extension fixes this, so a refresh, a DPoP
nonce retry or a fresh sign-in first would be wasted, and a refused request
touches no grant or Session.

## 3. Sign in and choose the meters

The sign-in is Poppy's usual Direct Sign-In with PAR, PKCE and DPoP
([§4.2](https://personalagentprotocol.org/docs/1.0/spec#direct-sign-in)). Only
the scopes and the consent page change. Iris asks for `espi:usage` and
`espi:summary`, the scopes its ESPI tools use, besides Fernwick's own
`account:read`, and never for `espi:customer` (the customer's name and service
address), which no tool reads.

Fernwick's consent page adds a "Meters to share" list, with Elena's two ticked
by default: Home and EV charger. She unticks Home. Approving with no meter
ticked is turned down (`400 invalid_request`).

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
at the end of each URI is the grant's ID. Every token response of the grant, at
the code exchange and at every refresh, carries the two fields. Other agents
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

The answer is an Atom feed (`application/atom+xml`), indented and trimmed here.
Only the EV charger is listed. A reading links to a ReadingType that says what
it measures: `uom` 72 is watt-hours, `intervalLength` 3600 is an hour and
`currency` 840 is US dollars.

## 6. Read last week's usage

The model calls Iris's `espi_usage` tool with local dates:

```json
{ "usagePointId": "UP-E2", "from": "2026-11-18", "to": "2026-11-24" }
```

The agent turns the dates into Pacific midnights, written in UTC, and asks for
the interval blocks in that window:

```http
GET https://energy-demo.poppylab.dev/espi/1_1/resource/Subscription/_mY5zLlQUROTfgo7jufBY2oPhKe6RHZp/UsagePoint/UP-E2/MeterReading/MR-E2/IntervalBlock?published-min=2026-11-18T08%3A00%3A00Z&published-max=2026-11-25T08%3A00%3A00Z&start-index=1&max-results=31
```

Fernwick answers with one `IntervalBlock` entry for each UTC day that overlaps
the window. This is the entry for 20 November, trimmed to one of its 24
readings:

```xml
<entry>
  <title>Hourly readings for 2026-11-20 (UTC)</title>
  <link href="…/MeterReading/MR-E2/IntervalBlock/2026-11-20" rel="self" type="espi-entry/IntervalBlock"/>
  <content>
    <espi:IntervalBlock>
      <espi:interval><espi:duration>86400</espi:duration><espi:start>1795132800</espi:start></espi:interval>
      …
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

The model sees none of this. The agent decodes the units, with values in
watt-hours times a power of ten.

The agent also puts days in the utility's local time, from the
`LocalTimeParameters` it read: a `tzOffset` of -28800, a `dstOffset` of 3600
and the rules `360E2000` and `B40E2000`. The tool answers in kWh and dollars
per local day, or per hour for at most three days, trimmed here to two of the
seven days and the highest hour:

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

## 7. Read the bills

The tool `espi_bills` asks for the bill summaries published in the last 92
days:

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

The tool answers in kWh and dollars, trimmed here to the October bill. Fernwick bills for a UTC month, closing at UTC midnight on the 1st, so the
agent dates a bill's period in UTC: in Pacific dates October would seem to start on 30
September.

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

Domain errors like these go to the model, bounded, as
`{ "error": "espi_error", "status": 404 }`. A bare `404` has no body, so the
model gets only the status.

Protocol errors never reach it as ESPI ones: `invalid_session`,
`session_ended`, `extension_required`, `insufficient_scope` and token challenges
in `WWW-Authenticate`. The transport tells them apart by the
known Poppy and OAuth codes and the challenge header, and for ESPI also by the
bare `404`.

## 9. Revoke the access

Revoking is Elena's action, not a tool the model has. Iris shows the
subscription's status in the account row, reading it from the Authorization at
`authorizationURI` with its `espi_authorization` tool, trimmed here to the
grant's status, end and scope:

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

The row also has a **Revoke ESPI access** button that asks again in the page.
Elena confirms, and Iris sends:

```http
DELETE https://energy-demo.poppylab.dev/espi/1_1/resource/Authorization/_mY5zLlQUROTfgo7jufBY2oPhKe6RHZp
```

```http
HTTP/1.1 204 No Content
```

That ends the grant, its access tokens and its refresh token, on the
ESPI-shaped API and on Fernwick's own API alike, and the next request gets
`401 invalid_token`:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: DPoP error="invalid_token"
Content-Type: application/json

{ "error": "invalid_token" }
```

Revoking the refresh token
([§4.6](https://personalagentprotocol.org/docs/1.0/spec#revocation)), or
disconnecting the agent in Fernwick's customer portal, ends the subscription the
same way. After the `204`, Iris signs the conversation out.

## What Fernwick controls

- It decides which scopes exist, what each unlocks and what each changes, runs
  the sign-in and the choice of meters on its own page, and applies the choice
  to the whole grant: the ESPI-shaped API, its own API and its Company Agent.
- It decides what a day and a bill are: both are UTC, and a window is the last
  31 days unless the agent asks for more, up to 92 days and an hour.
- It ends the grant. Without `offline_access` the grant ends with its first
  access token. With it, the grant refreshes for 7 days.
- It keeps writes out of this API: a switch between its plans stays on its own
  API, with approval of the exact terms.

## For the technical reader

[Domain extensions](README.md) explains why the extension exists, and
[FDX: bank data through Poppy](fdx.md) follows the same pattern with JSON.
[Write a domain extension](../write-an-extension.md) shows how to define one.
The contract is [`poppylab.dev/espi` v1](../../extensions/espi.md), and
Fernwick's side is in [its design note](../../fernwick-power.md#espi-shaped-api).

To run it, pick **Fernwick Power & Light** in the
[playground](https://poppylab.dev/playground), turn **Use ESPI** on, sign in and
share the EV charger.
