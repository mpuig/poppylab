# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated: a TypeScript monorepo using pnpm. Next.js (OpenNext on Cloudflare Workers, or Node) for the playground at poppylab.dev; a Hono Company gateway (`@poppy-lab/pap-company`) that runs the two fictional Companies on Workers with Durable Objects or on Node; provider-neutral LLM adapters. Public visitors are isolated: one Durable Object per visitor for the agent, sealed at rest, and one copy of each Company's fictional customers per agent user.

## Users

The primary users are protocol implementers and developers evaluating Personal Agent Protocol. They need to inspect discovery, identity, Session, authorization, and interaction behavior while using a familiar chat workflow. A secondary audience is technically curious end users trying a Personal Agent against a test Company.

## Product Purpose

Provide a practical environment for learning, implementing, and testing Personal Agent Protocol draft 0.3 (the text as retrieved on 3 November 2026; `pnpm spec:drift` reports changes). The product combines a Personal Agent playground, reusable client and server libraries, protocol inspection, and an example Company. Success means a developer can enter a Company URL, understand its advertised capabilities, run a task through a selected LLM, and inspect every safe, sanitized protocol step.

## Positioning

Unlike a generic chat client or browser agent, the playground treats PAP discovery, scoped Sessions, sign-in, DPoP, channel selection, and human approval as first-class observable objects. Secrets and request signing remain in deterministic code rather than model context.

## Operating Context

Developers use the product locally while implementing or evaluating PAP Companies and Personal Agents. The central workflow is URL discovery, capability inspection, task execution through OpenAPI, MCP, Company Agent conversations, or session-aware browsing, and review of a chronological protocol trace. The included example Company provides a safe commerce scenario for end-to-end testing.

## Capabilities and Constraints

- Target Personal Agent Protocol draft 0.3 only; protocol boundaries must be versioned because the specification is pre-1.0 and changes often.
- Accept a Company URL and validate `/.well-known/poppy.json` plus OAuth issuer metadata.
- Support provider-neutral LLM integration, beginning with OpenAI-compatible, Anthropic, Google, and local/Ollama adapters.
- Keep credentials, private keys, Session Tokens, Account Tokens, one-time codes, OAuth state, and DPoP material out of model context and user-visible traces.
- Prevent SSRF, unsafe redirects, private-network access, prompt-injection crossover, and unapproved consequential actions.
- Clearly distinguish PAP-capable Companies from ordinary websites; generic browser automation is not PAP.
- Example Company should eventually expose OpenAPI, MCP, PAP conversations, browser Session joining, sign-in, scopes, and approval-gated operations.
- The initial implementation may be an experimental MVP, but security boundaries should be architectural rather than deferred UI warnings.

## Brand Commitments

The working product name is “Poppy Lab.” Its voice is precise and developer-first without being austere. The user requested a clean, minimalist playground inspired by papplayground.com; prioritize model/URL setup and conversation, with protocol details available on demand. The interface should behave like a trustworthy instrument with an approachable chat layer. “Personal Agent Protocol” and “Poppy” are names belonging to the protocol project; the product must not imply endorsement or affiliation.

## Evidence on Hand

The authoritative protocol specification and Company implementation kit are published at personalagentprotocol.org. The community demos page lists other implementations; PAP Sandbox publishes 0.3 discovery but still uses 0.2 Session Tokens. No testimonials, customers, benchmarks, proprietary logos, or performance claims exist and none should be fabricated.

## Product Principles

1. Make the protocol legible: every important state transition should be inspectable.
2. Keep secrets below the model boundary.
3. Require human intent for identity, scope, and consequential changes.
4. Prefer standards-based deterministic machinery over model improvisation.
5. Treat protocol drift and interoperability findings as expected experimental output.

## Accessibility & Inclusion

The playground must be keyboard operable, responsive, compatible with reduced-motion preferences, and meet WCAG 2.2 AA contrast and focus requirements.
