# Poppy Lab

An independent test bench for the **Personal Agent Protocol, draft 0.3**: a Personal Agent you run with your own model key, and two fictional Companies it can sign in to. Everything runs on Cloudflare Workers or on Node from the same code.

- **https://poppylab.dev** explains the lab; **/playground** is the agent.
- **https://juniper.poppylab.dev** is Juniper Market, a grocery with a full customer website.
- **https://noodles.poppylab.dev** is Lantern Noodle Bar, a noodle bar with scheduled orders.

Nothing is sold, charged or shipped. Poppy Lab is not affiliated with or endorsed by the protocol's authors; "Personal Agent Protocol" and "Poppy" are their names. It makes no claim of conformance: the draft changes often (`pnpm spec:drift` reports when the published text differs from the pinned copy in `spec/`).

## What it does

- **Discovery and identity (§3, §4.1):** `poppy.json`, protected-resource and authorization-server metadata, an HTTPS `client_id` with metadata and JWKS.
- **Sessions (§5):** a delegated ES256 `Poppy-Session` header on every API request, one account per Session, DPoP-bound access tokens, refresh and revocation.
- **Direct Sign-In (§4.2)** on the Company's own consent page, read-only first, with a separate step to add change proposals.
- **Operations v2:** a change comes back as `approval_required`; the Company performs it only when the agent resends the same request with the user's `Poppy-Approval`, at most once. The model reads and proposes; only the user's click approves.
- **Companies you can inspect:** OpenAPI tools, excluded tasks, an Inspector that labels every step with its spec section and copies a trace for interop reports.
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
- `packages/pap-company`: the Hono Company gateway (discovery, sign-in, tokens, Sessions, Operations v2, tenancy) that runs both.
- `packages/pap-client`: discovery, safe transport, Session and DPoP cryptography.
- `packages/pap-core`: 0.3 schemas and shared types.
- `packages/llm-adapters`: provider-neutral model execution.

## Documentation

`docs/` holds the design notes: [PAP 0.3 notes](docs/pap-03.md), [coverage matrix](docs/pap-coverage.md), [portable runtime and deployment](docs/portable-runtime.md), [security review](docs/security-review.md), [community demos and interop](docs/community-demos.md), [Lantern](docs/lantern-noodles.md), and the Juniper website and service notes. `DESIGN.md` records the visual systems; `PRODUCT.md` the product context.

## Deploy

Three Cloudflare Workers, deployed with Wrangler: `pnpm --filter @poppy-lab/lantern deploy`, `pnpm --filter @poppy-lab/example-company deploy`, and for Poppy `pnpm --filter @poppy-lab/playground build:worker && pnpm --filter @poppy-lab/playground deploy:worker`. Poppy needs two secrets, `POPPY_IDENTITY` (the agent key pair) and `POPPY_STATE_KEY` (32 random bytes, base64url). See [portable runtime](docs/portable-runtime.md).
