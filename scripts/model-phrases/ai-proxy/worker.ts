/**
 * The free model's Workers AI binding, reached from the phrase runner on
 * this machine. `wrangler dev --remote` runs it on Cloudflare with the
 * account's own `AI` binding, so the runner's turns spend that account's
 * Neurons, as the deployed site's do. It answers only the runner, which
 * sends the token it started it with, and only the free model's model.
 */

/** The deployment's free model (`WORKERS_AI_MODEL` in llm-adapters). */
const MODEL = "@cf/google/gemma-4-26b-a4b-it";

type Env = {
  AI: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  PROXY_TOKEN?: string;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (
      !env.PROXY_TOKEN ||
      request.headers.get("x-proxy-token") !== env.PROXY_TOKEN
    )
      return new Response("Not found", { status: 404 });
    if (request.method === "GET") return Response.json({ ok: true });
    if (request.method !== "POST")
      return new Response("Method not allowed", { status: 405 });
    const { model, input } = (await request.json()) as {
      model?: unknown;
      input?: Record<string, unknown>;
    };
    if (model !== MODEL || !input || typeof input !== "object")
      return Response.json({ error: "Only the free model" }, { status: 400 });
    try {
      const answered = await env.AI.run(MODEL, input);
      if (answered instanceof ReadableStream)
        return new Response(answered, {
          headers: { "content-type": "text/event-stream" },
        });
      return Response.json(answered);
    } catch (error) {
      // The binding's code is in its message (4006: the day's free
      // allocation is used up; 3040: no capacity now).
      return Response.json(
        { error: error instanceof Error ? error.message : "Workers AI" },
        { status: 502 },
      );
    }
  },
};
