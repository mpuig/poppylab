# Northwind Air — fictional Poppy 1.0 airline

Northwind Air is a standalone fictional Company at `apps/northwind`, parallel to Juniper Market and Lantern Noodle Bar. It implements Personal Agent Protocol **1.0 only** through `@poppy-lab/pap-company`, including Direct Sign-In with PAR, DPoP-bound tokens and refresh, signed Sessions, task discovery, deterministic conversations and Operations v3 approvals.

Nothing in Northwind Air is real. No ticket is sold, changed or cancelled; no passenger travels; no loyalty points exist; no card is charged or refunded. The two test passengers are **Elena Maren** (`NW7K2P`) and **Robin Ito** (`NW4D8R`). Never enter real airline, identity, passport, payment or medical data.

## Run

```sh
pnpm install
pnpm --filter @poppy-lab/northwind dev
```

- Company and customer website: `http://northwind.localhost:4400`
- Account portal: `http://northwind.localhost:4400/account`
- Agent notes: `http://northwind.localhost:4400/for-agents`
- How it works, for a visitor: `http://northwind.localhost:4400/how-it-works` (the discovery document as served, the API's operations and Elena's upgrade waiting for approval, built from the same objects the endpoints serve)
- Discovery: `http://northwind.localhost:4400/.well-known/poppy.json`

The root `pnpm dev` starts Northwind with the other apps. In Iris, select Northwind Air or enter its URL. Initial consent requests only scopes marked as read-only. **Request change permission** asks for the reversible and consequential change scopes; every mutation still returns exact terms and waits for a separate Operations v3 approval.

## Capability shape

Signed out:

- flight search by fictional airport/date;
- cheapest-date suggestions;
- flight status;
- baggage, check-in and fare information;
- booking lookup with fictional reference and surname.

Signed in:

- upcoming trips and booking details;
- loyalty balance, tier and expiring points;
- meal and supported non-medical assistance preferences.

Approval-gated mutations:

- choose/change a no-fee standard seat;
- add paid checked baggage;
- set meal and assistance preferences;
- cancel a booking with exact fee/refund terms; its seats and cabin places go back on sale;
- accept the current upgrade offer;
- change a flight with old/new fare, fare difference, change fee, amount due or refund, and the standard seat assigned on the new flight (the current seat does not carry over; the seat is left unassigned when none is free). An upgrade, or an offer of one, is for its segment only: it does not carry over to the new flight, an accepted upgrade is not refunded, and the terms say so.

Operations include booking and inventory versions and current prices. If inventory or price changes after a proposal, the old revision cannot execute: the Company returns fresh terms for a new approval. Approved execution is idempotent; a retry gets the first response.

## An agent's browser

An agent's own browser can be joined to the agent's Session at `/poppy/browser-session` ([Poppy 1.0, Web browsing](poppy-1.0.md#web-browsing-6)). Joined with an access token that has `poppy:browser-sign-in`, it is signed in to the token's account on My Northwind (`/account`), in place of any login it had, and the page tells it so: "This browser belongs to an agent's session. It is signed in through the agent and shows what you allowed the agent to read. Nothing can be changed here: changes are made through the agent and wait for your approval there." A part it has no scope for is left out and named with the scope to ask for.

| On the account page                                                         | A joined browser                                                                          |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Upcoming trips                                                              | Sees them with `bookings:read`                                                            |
| Gale loyalty, passenger preferences                                         | Sees them with `profile:read`                                                             |
| Agent activity, feedback from agents, connected agents                      | Never sees them: they are the customer's own                                              |
| The customer's own controls: disconnect an agent, switch passenger, log out | Not rendered, and every request that isn't a read is refused with 403 `read_only_browser` |

Without a token the joined browser is signed out: `/account` sends it to `/site/login`, which shows it no form. A customer's own browser, logged in on the website, keeps every control, whether or not an agent's browser is joined to the same copy. `src/browser-session.test.ts` runs the suite every Company shares (`browserJoinSuite` in `@poppy-lab/pap-company/testing`): the scope and its consent line, the signed-in join end to end, each part with and without its scope, every writing route refused, and the customer's browser unaffected.

## Scopes

| Scope               | Purpose                                           | Hint                   |
| ------------------- | ------------------------------------------------- | ---------------------- |
| `flights:search`    | Public search shape; no personal data             | no changes             |
| `bookings:read`     | Trips and booking details                         | no changes, personal   |
| `profile:read`      | Loyalty and passenger preferences                 | no changes, personal   |
| `preferences:write` | Seats, meals and supported non-medical assistance | reversible, personal   |
| `bookings:change`   | Bags, cancellation, upgrade and flight change     | irreversible, personal |

The shared gateway accepts the complete declared scope set, withholds every configured write scope unless consent submits `write=yes`, and uses the Company's route-level scope resolver for account APIs. Existing two-scope Companies retain their default behavior.

## Excluded tasks

`/poppy/tasks` explicitly excludes visa/transit eligibility decisions, border-entry guarantees, legal-name changes, passport/visa/identity document verification, and assistance cases requiring medical or document verification. The protocol supports only the listed non-medical assistance preferences.

The same response lists two skills in its `skill_index` (§9.4), `add-checked-bags` and `accept-upgrade-offer`, each a `SKILL.md` served at `/poppy/skills/{name}/SKILL.md`: the permissions, the order of calls and what the common outcomes mean.

## Deployment

```sh
pnpm --filter @poppy-lab/northwind dev:worker
pnpm --filter @poppy-lab/northwind run deploy
```

`wrangler.toml` deploys `NorthwindCompany`, a SQLite-backed Durable Object, to `airline-demo.poppylab.dev` with per-visitor fictional business state. Set an optional consent password with the `NORTHWIND_PASSWORD_HASH` Worker secret. For local Wrangler development, `DEV_HTTP_CLIENT` may name the exact local Iris client metadata URL; it is honored only on a localhost Company origin.

## Direction contract

**THESIS:** Northwind is a working synoptic route chart, not a generic airline hero with a destination photograph. Search is the first action and the same schedule powers the site, APIs and account.

**OWN-WORLD:** Pale weather-map blue and paper, deep pressure-system ink, wind blue, one sun-yellow action color, condensed operational headings, mono flight data, thin isobars and route tracks.

**STORY:** A visitor searches the fictional timetable, sees what remains signed out, connects Iris, chooses a test passenger on Northwind's page, and approves exact account changes.

**FIRST VIEWPORT:** A large route-chart field carries the headline and curved isobars; a real origin/destination/date search panel occupies the right side and submits to the public API. The protocol honesty notice stays visible beside the offer.

**FORM:** Sixth grounded direction, a synoptic weather chart and route briefing. `seed:9804742bceb4ffaa`.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
