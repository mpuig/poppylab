# Model phrases

The unit tests answer every turn with a fake model, so they never show how a real model behaves: its tone and language, which Company it picks, whether it keeps a request to the Company it was for, how it connects a Company from words. `pnpm phrases` asks a real model about fifteen real phrases through the agent's own code and checks each answer. It is run by hand before a promotion, never in CI: it spends model usage, and its answers aren't the same twice.

## Run it

```sh
pnpm phrases --model free                  # Workers AI, through wrangler dev --remote
pnpm phrases --model openai                # OPENAI_API_KEY from your environment
pnpm phrases --model anthropic             # ANTHROPIC_API_KEY from your environment
pnpm phrases --model demo                  # no model: checks the runner itself
pnpm phrases --model free --case es-transfer,en-bill-pay
pnpm phrases --list
```

- `--model free` is the deployment's free model, `@cf/google/gemma-4-26b-a4b-it`, through the Workers AI binding of your own Cloudflare account: the runner starts a small Worker (`scripts/model-phrases/ai-proxy/`) with `wrangler dev --remote` under your existing `wrangler login`, on a local port, and stops it at the end. It answers only that run's random token and only that model. The turn still goes through the core's free-model path, Turnstile and limits included: the runner sets Cloudflare's published test keys (site `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`, which pass the dummy token every time) in its own process only. The core accepts that secret's answers only outside public mode, so it can't open the free model on a deployment, and no configuration file holds it. `--max-neurons` (default 3000) caps the run; the core stops a turn that would pass it.
- `--model openai` and `--model anthropic` take the key from the environment of whoever runs it. The runner only checks that the variable is set; the core reads it, as it does in local development, so the key is never in the runner's requests to the agent, its output or the report. `--model-name` picks the model; otherwise `OPENAI_MODEL` or `ANTHROPIC_MODEL`, then the adapters' defaults.
- `--model demo` asks no model. Most phrases then get demo mode's guided answer and fail, which is expected: it shows that the conversations, sign-ins and checks work before you spend anything.

The runner needs nothing running. It starts each lab Company it needs on its local port (`apps/<company>/src/node.ts`) unless one already answers there, and stops what it started. The local Companies trust only the agent at `http://localhost:3000`, so it needs that port too: when it's free, the runner serves the agent's client metadata and keys there from a key pair made for the run, with the playground's own route handlers; when the playground already runs there from this checkout, it uses that playground's keys instead, and stops if the keys there are someone else's.

## How a case runs

The cases are data in `scripts/model-phrases/cases.ts`: the phrase, the conversation it needs and what the turn should do. Each case starts from nothing, as a new visitor:

1. A conversation through `POST /api/v1/conversations` with the first Company, signed out; the others connected in words in demo mode, which asks no model.
2. Each sign-in through `POST /api/v1/conversations/{id}/sign-ins`, the Company's consent page answered with Allow for the test customer it opens on, and the agent's callback, as in the [production checks](portable-runtime.md#checking-production). The change permission is asked for where the case needs it.
3. Any earlier turns, asked of the same model.
4. The phrase, through `POST /api/v1/conversations/{id}/messages` with the chosen model, answered whole (not streamed). Local development takes 20 chat requests a minute in all, so a 429 is asked again 30 seconds later.
5. Every proposal still waiting is declined and every Company signed out, so nothing is left at a Company.

Everything goes through `v1` of `@poppy-lab/pap-agent/api-http` in the runner's process, with conversations kept in memory: the developer's vault isn't touched. A phrase that is one of demo mode's scripted examples is answered by the script whatever model is chosen, so the runner refuses to start if a case uses one.

## What it checks

| Column       | Passes when                                                                                                                                                                                                                                                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| went to      | The turn's answers name the Companies the case expects, or, for an ambiguous request, the agent asked which with choices before sending anything. A free-model turn that ran in demo mode fails here.                                                                                                                         |
| privacy      | No request reached a Company the User didn't address: neither in the steps the turn recorded (the Inspector's trace) nor on the wire. The runner listens to `undici:request:create`, so it sees every request the process makes, by origin and path only. The detail says how many went where, and any the trace didn't show. |
| language     | The answer's words, without what it quotes from a Company and without the Companies' names, score highest for the User's language on the core's own word lists (`languageScores`). A tie is a warning.                                                                                                                        |
| no IDs       | No ID, slot code or key in Iris's words: `ord_LNB1001`, `acc_HLB_A100`, `sun-1300`, `matcha-ice`, a UUID.                                                                                                                                                                                                                     |
| no tool talk | No tool's name (`list_orders`), no talk of tools, no "I called…".                                                                                                                                                                                                                                                             |
| terms once   | When the turn made a proposal: the answer doesn't say its amounts (a failure) or its names and memo (a warning), which the approval question after it says.                                                                                                                                                                   |
| length       | The answer, without that question, is at most 450 characters, or the case's own limit (a menu may be longer).                                                                                                                                                                                                                 |
| expected     | What the case asks of the conversation afterwards: which Companies are connected, a Company removed or a question to confirm removing it, whether a proposal waits, words the answer must hold.                                                                                                                               |

Each case's line is printed as it ends, with the answer in full, then the table and a summary: cases passed and failed, the model, the Neurons or tokens used, and the time. The same goes to a Markdown report under `scripts/model-phrases/reports/`, which git ignores, with each check's detail, the steps each turn recorded and its requests to each Company by method and path. Neither holds a key, cookie, code, `state` or `request_uri`: addresses lose their query. The checks are a first reading; the answers are there for a person to read.

## Cost

A free-model run of the fifteen cases took 1,504 Neurons and four minutes on 28 November 2026, plus about half a minute to start the Worker and the Companies: a read is 60 to 115 Neurons, a turn that loses its way up to 160. Workers AI gives the account 10,000 Neurons a day at no charge, shared with the deployed site's visitors, whose own cap is 7,000; past them Workers Paid charges $0.011 per 1,000. With OpenAI or Anthropic it is sixteen turns, each a few thousand input tokens, at the key owner's prices. The runner prints what the run used: Neurons as the core counts them, or the tokens each provider reports.
