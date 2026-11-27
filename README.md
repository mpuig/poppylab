# Poppy Lab

An independent test bench for **Personal Agent Protocol 1.0**: **Iris**, a Personal Agent you run with your own model key, and five fictional Companies it can sign in to. Everything runs on Cloudflare Workers or on Node from the same code.

- **https://poppylab.dev** explains the protocol and its benefits in plain language; **/learn** teaches it, from everyday processes to every request of a task; **/developers** has the endpoints, scopes and spec sections; **/playground** is Iris.
- **https://grocery-demo.poppylab.dev** is Juniper Market, a grocery with a full customer website.
- **https://food-demo.poppylab.dev** is Lantern Noodle Bar, a noodle bar with scheduled orders, whose agent refunds a missing dish once you approve.
- **https://bank-demo.poppylab.dev** is Harborline Bank, a fully fictional bank with accounts, transactions, cards, recipients, budgets, payments and transfers, plus a read-only FDX-shaped API (not FDX-conformant or certified) behind the `poppylab.dev/fdx` extension.
- **https://airline-demo.poppylab.dev** is Northwind Air, a fictional airline with flight search, trips, loyalty and approval-gated booking changes.
- **https://energy-demo.poppylab.dev** is Fernwick Power & Light, a fictional electricity utility with hourly meter readings, monthly bills and an approval-gated rate plan switch, plus a read-only ESPI-shaped API (modelled on NAESB REQ.21 ESPI, not certified) behind the `poppylab.dev/espi` extension.

Nothing is sold, charged, shipped or transferred. Harborline moves no real money; Northwind sells or changes no real ticket; Fernwick supplies and bills no electricity. No real banking, passenger, payment or account credentials should be entered anywhere in the demo. Poppy Lab is not affiliated with or endorsed by the protocol's authors; "Personal Agent Protocol" and "Poppy" are their names. It makes no claim of conformance: the draft changes often (`pnpm spec:drift` reports when the published text differs from the pinned copy in `spec/`). On 26 November 2026 all five Companies ran the official validator from the protocol's Company implementation kit with no failures ([results](docs/learn/validator.md)); passing it is not a certification.

## What it does

- **Discovery, versions and identity (§3, §4.1):** `poppy.json` 1.0 with `supported_versions`, extensions declared per request, protected-resource and authorization-server metadata, an HTTPS `client_id` with metadata and JWKS (ES256 or PS384 accepted).
- **Sessions (§5):** a delegated ES256 `Poppy-Session` header and `Poppy-Version: 1.0` on every request, `session_ended` for a second account, DPoP-bound access tokens, refresh only with the same DPoP key, and revocation.
- **Direct Sign-In (§4.2)** through a pushed authorization request when offered, with `prompt=consent`, on the Company's own consent page: read-only first, with a separate step to add change proposals.
- **Operations v3:** a change comes back as `approval_required` with its exact terms; the Company performs it only when the agent resends the same request with the user's approval in `Poppy-Approval` (who approved, when, and a reference), at most once. The model reads and proposes; only the user's click approves.
- **Conversations (§8):** each Company has its own agent. It's deterministic, takes structured requests in `data` and answers with data, so the only model is yours. It asks for sign-in with an authorization event, proposes a refund or a support case as an Operations v3 operation inside a message, and answers a handoff with a (fictional) phone number. See [conversations](docs/conversations.md).
- **Several Companies in one conversation:** up to three, each with its own sign-in, Session, grant and proposals. Each message goes to one of them, and Iris asks which when it can't tell. Companies are added and removed at any moment, by name in a message or from the Companies bar; removing a signed-in one revokes its grant first.
- **Companies you can inspect:** OpenAPI tools, excluded tasks read per Session from the tasks endpoint (§9), an Inspector that labels every step with its spec section and copies a trace for interop reports.
- **Public and isolated:** every visitor gets their own agent state (sealed at rest) and their own copy of each Company's fictional customers; rate limits per visitor, IP and globally.

## Run it locally

Requires Node.js 22.18+ and pnpm 11.

```sh
pnpm install
pnpm dev
```

- Playground: http://localhost:3000/playground
- Juniper Market: http://juniper.localhost:4100 (customer site at `/account`)
- Lantern Noodle Bar: http://noodles.localhost:4200 (customer site at `/account`)
- Harborline Bank: http://harbor.localhost:4300 (customer portal at `/account`)
- Northwind Air: http://northwind.localhost:4400 (customer portal at `/account`)
- Fernwick Power & Light: http://fernwick.localhost:4500 (customer portal at `/account`)

The playground starts in demo mode, with no key: it runs scripted examples, the suggestions under the conversation and the messages Learn has you type, and fixed rules call the Company's tools for them. They read at every Company, through the domain extension too with Use FDX or Use ESPI on, and propose one kind of change at each of the first four (a delivery day, an order, a transfer or payment, an upgrade or a bag). Anything else gets an answer from Iris that offers the examples; to ask in your own words, press "Use your own model" and paste an OpenAI or Anthropic key. Pick a Company, sign in as a fictional customer (Elena or Robin), ask for a change, and approve it in Needs you, above the message box. The Company website shows the same data within two seconds.

To use the local environment keys instead, `cp apps/playground/.env.example apps/playground/.env.local` and set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. Keys never reach the model context, the Companies, logs or the Worker bundle (`build:worker` refuses a bundle that contains a local secret).

## Checks

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm scenarios
pnpm build
pnpm spec:drift
```

## Workspace

- `apps/playground`: the Next.js web channel of the agent (OpenNext on Workers or `next start`): the page, its routes over the agent's core, `/api/v1`, per-visitor state in Durable Objects, the home page and Learn.
- `apps/juniper`: Juniper Market, a `CompanyDefinition` with a customer portal.
- `apps/lantern`: Lantern Noodle Bar, a second independent Company.
- `apps/harborline`: Harborline Bank, a standalone fictional banking Company with a matching customer portal and narrow banking scopes.
- `apps/northwind`: Northwind Air, an airline-shaped Company with differentiated scopes, stale fare/inventory revisions and a customer portal.
- `apps/fernwick`: Fernwick Power & Light, an electricity utility with an ESPI-shaped Atom XML API next to its own, and a customer portal.
- `packages/pap-agent`: the Personal Agent's core (conversations and their storage, connections to Companies, routing, the model turn, demo mode, approvals, sign-in) and its channel-neutral API, described in `openapi.json`; see [docs/pap-agent.md](docs/pap-agent.md).
- `packages/pap-company`: the Hono Company gateway (discovery, sign-in with PAR, tokens, Sessions, conversations, Operations v3, tenancy) that runs all five fictional Companies.
- `packages/pap-client`: discovery, safe transport, Session and DPoP cryptography, and the tools Iris builds from a Company's OpenAPI, MCP, FDX and ESPI descriptions.
- `packages/pap-core`: 1.0 schemas and shared types, and the pieces the Companies' websites share (the consent sheet, the how-it-works page).
- `packages/llm-adapters`: provider-neutral model execution.

## Documentation

Start with **Learn**, at [poppylab.dev/learn](https://poppylab.dev/learn) or in [`docs/learn`](docs/learn/README.md): how everyday processes work one screen at a time, one task request by request, Poppy compared with an API, MCP, browser automation and UCP, conversations, approvals, domain extensions (FDX, ESPI), how to build a Company, a Personal Agent or an extension, the official validator's results and a glossary. The site pages are built from the same Markdown.

[`docs/`](docs/README.md) also holds the design notes for contributors ([Poppy 1.0](docs/poppy-1.0.md), the [coverage matrix](docs/coverage.md), the [portable runtime](docs/portable-runtime.md), one note per Company) and, in [`docs/history`](docs/history), notes from earlier drafts. `DESIGN.md` records the visual systems; `PRODUCT.md` the product context.

## Deploy

Six Cloudflare Workers, deployed with Wrangler: `pnpm --filter @poppy-lab/lantern run deploy`, `pnpm --filter @poppy-lab/juniper run deploy`, `pnpm --filter @poppy-lab/harborline run deploy`, `pnpm --filter @poppy-lab/northwind run deploy`, `pnpm --filter @poppy-lab/fernwick run deploy`, and for Poppy `pnpm --filter @poppy-lab/playground build:worker && pnpm --filter @poppy-lab/playground deploy:worker`. Poppy needs two secrets, `POPPY_IDENTITY` (the agent key pair) and `POPPY_STATE_KEY` (32 random bytes, base64url). See [portable runtime](docs/portable-runtime.md).

## License

Apache License 2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE). The copies of the Personal Agent Protocol 1.0 documents in `spec/1.0/` belong to the protocol authors and are published by them under the same license.
