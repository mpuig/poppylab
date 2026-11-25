# Poppy Lab

An independent test bench for **Personal Agent Protocol 1.0**: **Iris**, a Personal Agent you run with your own model key, and four fictional Companies it can sign in to. Everything runs on Cloudflare Workers or on Node from the same code.

- **https://poppylab.dev** explains the protocol and its benefits in plain language; **/developers** has the endpoints, scopes and spec sections; **/playground** is Iris.
- **https://juniper.poppylab.dev** is Juniper Market, a grocery with a full customer website.
- **https://noodles.poppylab.dev** is Lantern Noodle Bar, a noodle bar with scheduled orders.
- **Harborline Bank** targets **https://harborline.poppylab.dev** when deployed: a fully fictional bank with accounts, transactions, cards, recipients, budgets, payments and transfers.
- **Northwind Air** targets **https://northwind.poppylab.dev** when deployed: a fictional airline with flight search, trips, loyalty and approval-gated booking changes.

Nothing is sold, charged, shipped or transferred. Harborline moves no real money; Northwind sells or changes no real ticket. No real banking, passenger, payment or account credentials should be entered anywhere in the demo. Poppy Lab is not affiliated with or endorsed by the protocol's authors; "Personal Agent Protocol" and "Poppy" are their names. It makes no claim of conformance: the draft changes often (`pnpm spec:drift` reports when the published text differs from the pinned copy in `spec/`).

## What it does

- **Discovery, versions and identity (§3, §4.1):** `poppy.json` 1.0 with `supported_versions`, extensions declared per request, protected-resource and authorization-server metadata, an HTTPS `client_id` with metadata and JWKS (ES256 or PS384 accepted).
- **Sessions (§5):** a delegated ES256 `Poppy-Session` header and `Poppy-Version: 1.0` on every request, `session_ended` for a second account, DPoP-bound access tokens, refresh only with the same DPoP key, and revocation.
- **Direct Sign-In (§4.2)** through a pushed authorization request when offered, with `prompt=consent`, on the Company's own consent page: read-only first, with a separate step to add change proposals.
- **Operations v3:** a change comes back as `approval_required` with its exact terms; the Company performs it only when the agent resends the same request with the user's approval in `Poppy-Approval` (who approved, when, and a reference), at most once. The model reads and proposes; only the user's click approves.
- **Conversations (§8):** each Company has its own agent. It's deterministic, takes structured requests in `data` and answers with data, so the only model is yours. It asks for sign-in with an authorization event, proposes a refund or a support case as an Operations v3 operation inside a message, and answers a handoff with a (fictional) phone number. See [conversations](docs/conversations.md).
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

Choose **Protocol demo** in Model settings to try it without a key (keyword rules call the Company's tools), or paste an OpenAI or Anthropic key. Connect a Company, sign in as a fictional customer, ask for a change, and approve it from the card in the chat. The Company website shows the same data within two seconds.

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

- `apps/playground`: the Next.js agent (OpenNext on Workers or `next start`), per-visitor state in Durable Objects, the home page.
- `apps/example-company`: Juniper Market, a `CompanyDefinition` with a customer portal.
- `apps/lantern`: Lantern Noodle Bar, a second independent Company.
- `apps/harborline`: Harborline Bank, a standalone fictional banking Company with a matching customer portal and narrow banking scopes.
- `apps/northwind`: Northwind Air, an airline-shaped Company with differentiated scopes, stale fare/inventory revisions and a customer portal.
- `packages/pap-company`: the Hono Company gateway (discovery, sign-in with PAR, tokens, Sessions, conversations, Operations v3, tenancy) that runs all four fictional Companies.
- `packages/pap-client`: discovery, safe transport, Session and DPoP cryptography.
- `packages/pap-core`: 1.0 schemas and shared types.
- `packages/llm-adapters`: provider-neutral model execution.

## Documentation

Start with [Learn Poppy by running it](docs/learn/README.md): one task request by request, Poppy compared with an API, MCP, browser automation and UCP, and the official validator's results.

`docs/` holds the design notes: [Poppy 1.0 notes](docs/pap-10.md), [coverage matrix](docs/pap-coverage.md), [portable runtime and deployment](docs/portable-runtime.md), [security review](docs/security-review.md), [community demos and interop](docs/community-demos.md), [Lantern](docs/lantern-noodles.md), [Harborline](docs/harborline-bank.md), [Northwind Air](docs/northwind-air.md), and the Juniper website and service notes. `DESIGN.md` records the visual systems; `PRODUCT.md` the product context.

## Deploy

Five Cloudflare Workers, deployed with Wrangler: `pnpm --filter @poppy-lab/lantern deploy`, `pnpm --filter @poppy-lab/example-company deploy`, `pnpm --filter @poppy-lab/harborline deploy`, `pnpm --filter @poppy-lab/northwind deploy`, and for Poppy `pnpm --filter @poppy-lab/playground build:worker && pnpm --filter @poppy-lab/playground deploy:worker`. Poppy needs two secrets, `POPPY_IDENTITY` (the agent key pair) and `POPPY_STATE_KEY` (32 random bytes, base64url). See [portable runtime](docs/portable-runtime.md).

## License

Apache License 2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE). The copies of the Personal Agent Protocol 1.0 documents in `spec/1.0/` belong to the protocol authors and are published by them under the same license.
