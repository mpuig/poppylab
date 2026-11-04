import {
  accountRecovery,
  accountUnavailableNotice,
} from "@/lib/account-recovery";
import { NextResponse } from "next/server";
import { ProtocolError } from "@poppy-lab/pap-client";
import { shoppingTarget } from "@/lib/shopping-context";
import { cookies } from "next/headers";
import { connect, type Run } from "@/lib/runtime";
import type { CompanyEntry } from "@/lib/conversations";
import {
  acquireRun,
  createRun,
  releaseRun,
  visitorOf,
  secureCookies,
  type Held,
} from "@/lib/runs";
import { overBudget } from "@/lib/limits";
import { pickDemoTool } from "@/lib/demo-tool";
import { UserFacingError } from "@/lib/user-error";
import { PapDiscoveryError } from "@poppy-lab/pap-core";
import { publicMode, serving } from "@/lib/deployment";
import { runModel, ModelRequestError } from "@poppy-lab/llm-adapters/server";

export const runtime = "nodejs";
let active = 0;
let count = 0;
let windowStart = Date.now();
export async function POST(request: Request) {
  if (!serving())
    return NextResponse.json(
      { error: "Chat is disabled on this deployment." },
      { status: 403 },
    );
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return NextResponse.json(
      { error: "Same-origin browser requests required" },
      { status: 403 },
    );
  if (Date.now() - windowStart > 60000) {
    count = 0;
    windowStart = Date.now();
  }
  // Per isolate; public budgets per visitor, IP and globally follow.
  if (active >= (publicMode() ? 20 : 3) || count >= (publicMode() ? 120 : 20))
    return NextResponse.json(
      { error: "Chat is busy; retry in a minute." },
      { status: 429 },
    );
  active++;
  count++;
  let run: Run | undefined;
  let held: Held | undefined;
  let visitor: string | undefined;
  let stage = "request";
  try {
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new UserFacingError("Use JSON");
    const reader = request.body?.getReader();
    if (!reader) throw new UserFacingError("Missing request");
    let data = "";
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new UserFacingError("Request timed out")),
        3000,
      );
    });
    try {
      while (true) {
        const chunk = await Promise.race([reader.read(), deadline]);
        if (chunk.done) break;
        data += Buffer.from(chunk.value).toString("utf8");
        if (Buffer.byteLength(data) > 6000)
          throw new UserFacingError("Request too large");
      }
    } finally {
      clearTimeout(timer!);
      void reader.cancel();
    }
    const body = JSON.parse(data) as {
      url?: unknown;
      message?: unknown;
      provider?: unknown;
      apiKey?: unknown;
      model?: unknown;
    };
    if (
      typeof body.url !== "string" ||
      body.url.length > 2048 ||
      typeof body.message !== "string" ||
      !body.message.trim() ||
      body.message.length > 2000
    )
      throw new UserFacingError(
        "Enter a Company URL and a message of at most 2000 characters.",
      );
    if (
      (body.apiKey !== undefined &&
        (typeof body.apiKey !== "string" ||
          body.apiKey.length > 2048 ||
          /[\r\n]/.test(body.apiKey))) ||
      (body.model !== undefined &&
        (typeof body.model !== "string" ||
          body.model.length > 120 ||
          !/^[a-zA-Z0-9._:/-]*$/.test(body.model)))
    )
      throw new UserFacingError("Invalid model configuration");
    const localDev =
      process.env.NODE_ENV === "development" &&
      ["localhost", "127.0.0.1"].includes(new URL(request.url).hostname);
    if (body.provider && body.provider !== "demo" && !localDev && !body.apiKey)
      return NextResponse.json(
        { error: "Add your API key in Model settings." },
        { status: 400 },
      );
    // Public: only the offered providers, each with the visitor's own key.
    if (
      !localDev &&
      body.provider !== undefined &&
      !["demo", "openai-compatible", "anthropic"].includes(
        String(body.provider),
      )
    )
      return NextResponse.json(
        { error: "Unsupported model provider." },
        { status: 400 },
      );
    if (body.apiKey && body.provider === "ollama")
      return NextResponse.json(
        { error: "Ollama does not use an API key." },
        { status: 400 },
      );
    const store = await cookies();
    visitor = visitorOf(store, true);
    const limited = await overBudget(request, visitor, "chat");
    if (limited) return limited;
    const current = await acquireRun(visitor, store.get("pap_run")?.value);
    if (current === "busy")
      throw new UserFacingError("Wait for the current response.");
    held = current;
    if (!held || new URL(held.run.url).href !== new URL(body.url).href) {
      if (held) await releaseRun(visitor, held);
      held = await createRun(visitor, body.url);
      store.set("pap_run", held.id, {
        httpOnly: true,
        secure: secureCookies(),
        sameSite: "strict",
        path: "/",
        maxAge: 1800,
      });
    }
    run = held.run;
    if (run.calls >= 20)
      throw new UserFacingError(
        "This run reached its 20-turn limit. Connect again to start another run.",
      );
    const trace: string[] = [];
    const shown: CompanyEntry[] = [];
    stage = "pap";
    const tools = await connect(run, trace, shown);
    // A turn counts once the Company answered; a failed discovery is free.
    run.calls++;
    const provider = typeof body.provider === "string" ? body.provider : "demo";
    let text: string;
    const lowered = body.message.toLowerCase();
    if (
      provider === "demo" &&
      tools.company_agent_send &&
      /customer service|support|company'?s agent|talk to|speak to|a person|human|someone/.test(
        lowered,
      )
    ) {
      // The demo's way into a conversation (§8): ask what the Company's agent
      // handles, or ask for a person (which needs a conversation first).
      const person = /talk to|speak to|a person|human|someone/.test(lowered);
      const results: unknown[] = [];
      if (!person || !run.conversation?.id)
        results.push(
          await tools.company_agent_send.execute({ data: { request: "help" } }),
        );
      if (person) results.push(await tools.company_agent_handoff!.execute({}));
      text = `Protocol demo (no LLM). Live Company Agent ${person ? "handoff" : "reply"}:\n\n${JSON.stringify(results.at(-1), null, 2)}\n\nThe Company's agent answers structured requests. For a real conversation with it, select a model.`;
    } else if (provider === "demo") {
      const message = lowered;
      const day = ["saturday", "tuesday", "thursday"].find((day) =>
        message.includes(day),
      );
      const editingItem =
        /\b(remove|add|set|quantity)\b/.test(message) &&
        /orange|broccoli|apple|coffee/.test(message);
      const target = shoppingTarget(message, run.history);
      const selected =
        editingItem && target
          ? target === "delivery"
            ? "propose_delivery_item_quantity"
            : "propose_basket_quantity"
          : /checkout|check out|place.*order/.test(message)
            ? "propose_checkout"
            : /basket|cart/.test(message)
              ? /add|remove|quantity|set/.test(message)
                ? "propose_basket_quantity"
                : "my_basket"
              : /my.*order|order.*my/.test(message)
                ? "my_orders"
                : /move|change|reschedul/.test(message) &&
                    day &&
                    tools.propose_delivery_change
                  ? "propose_delivery_change"
                  : /my.*deliver|deliver.*my/.test(message) &&
                      tools.my_deliveries
                    ? "my_deliveries"
                    : /deliver|ship|saturday|tuesday|thursday/.test(message)
                      ? "delivery_info"
                      : /hour|return|refund|open|policy/.test(message)
                        ? "store_policies"
                        : "list_products";
      // Another Company's tools: never guess arguments for unknown schemas,
      // and never talk to the Company's agent unless asked (above).
      const fallback = tools[selected]
        ? selected
        : pickDemoTool(
            message,
            Object.fromEntries(
              Object.entries(tools).filter(
                ([name]) => !name.startsWith("company_agent_"),
              ),
            ),
          );
      const selectedTool = fallback ? tools[fallback] : undefined;
      const product_id = /coffee/.test(message)
        ? "coffee"
        : /broccoli/.test(message)
          ? "broccoli"
          : /apple/.test(message)
            ? "apples"
            : "oranges";
      const quantity = /remove/.test(message)
        ? 0
        : Number(message.match(/\b\d+\b/)?.[0] ?? 1);
      if (!selectedTool) {
        text =
          "Protocol demo (no LLM): every tool at this Company needs arguments the demo can't choose. Pick a model to try it, or inspect its tools in the Inspector.";
      } else if (editingItem && !target) {
        text =
          "Do you mean your shopping basket or your recurring delivery? Please name which one; no changes have been proposed.";
      } else {
        const allowed = selectedTool.schema.properties as Record<
          string,
          unknown
        >;
        const args = {
          product_id,
          quantity,
          day: day ? day[0]!.toUpperCase() + day.slice(1) : "Saturday",
        };
        const result = await selectedTool.execute(
          Object.fromEntries(
            Object.entries(args).filter(([key]) => Object.hasOwn(allowed, key)),
          ),
        );
        text = `Protocol demo (no LLM). Live Company response:\n\n${JSON.stringify(result, null, 2)}\n\n${tools.my_basket ? "Try “my basket”, “set apples in my basket to 2”, “checkout on Saturday”, “my orders”, or “my deliveries”. Basket edits and checkout are proposals only until you click Approve. Demo quantities are absolute totals, not increments." : `The demo called ${fallback}, a tool that needs no arguments.`} For natural-language reasoning, select a model.`;
      }
    } else {
      stage = "provider";
      text = await runModel(
        provider,
        [...run.history.slice(-10), { role: "user", content: body.message }],
        tools,
        {
          apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
          model: typeof body.model === "string" ? body.model : undefined,
        },
      );
    }
    run.history.push(
      { role: "user", content: body.message },
      { role: "assistant", content: text },
    );
    run.history = run.history.slice(-10);
    return NextResponse.json(
      {
        text,
        trace,
        sessionId: run.sessionId,
        mode: provider,
        signedIn: !!run.accountToken && !run.accountUnavailable,
        scopes: run.scopes,
        recovery: run.accountUnavailable ? accountUnavailableNotice : undefined,
        operations: Object.values(run.operations ?? {}),
        company: shown,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const recovery = accountRecovery(error);
    // Signed out, a token error means the Company refused the Session
    // itself: there is no account access to renew (often a different draft).
    if (
      recovery &&
      run &&
      !run.accountToken &&
      error instanceof ProtocolError &&
      error.code === "invalid_token"
    )
      return NextResponse.json(
        {
          error:
            "The Company refused this signed-out PAP 0.3 Session. It may implement a different draft of the protocol; check its discovery in the Inspector.",
          code: "session_refused",
          stage,
        },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    // Signed out, a plain sign-in challenge is not lost access.
    if (recovery && run && !run.accountToken)
      return NextResponse.json(
        {
          error:
            "This needs your account at the Company. Use Sign in in the chat if the Company offers it; nothing was sent on your behalf.",
          code: "sign_in_required",
          next: "signin",
          stage,
        },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    if (recovery) {
      if (run && recovery.next === "signin") run.accountUnavailable = true;
      return NextResponse.json(
        { ...recovery, stage },
        { status: recovery.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (error instanceof ModelRequestError) {
      return NextResponse.json(
        { error: error.message, code: error.code, stage: "provider" },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    // A Company's protocol error: its status and code are safe to show
    // (never its free text) and are what an interop report needs.
    if (error instanceof ProtocolError) {
      const code = /^[A-Za-z0-9_.:-]{1,64}$/.test(error.code ?? "")
        ? error.code
        : undefined;
      return NextResponse.json(
        {
          error: `The Company answered HTTP ${error.status}${code ? ` ${code}` : ""}. Nothing was retried; see the Inspector.`,
          code: code ?? "company_error",
          stage,
        },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    const message = error instanceof Error ? error.message : "Chat failed";
    // Operator log: stage and error class only; never the request, keys or tokens.
    console.error(
      "chat_failed",
      stage,
      error instanceof Error ? `${error.name}: ${message.slice(0, 160)}` : "",
    );
    // Only messages written for the visitor are shown; discovery errors are
    // ours too (the same text the Connect step shows).
    const safe =
      error instanceof UserFacingError ||
      error instanceof PapDiscoveryError ||
      // Local provider configuration hints from the adapters, nothing else.
      (stage === "provider" &&
        /^(Set [A-Z_]+_API_KEY|Unknown model)/.test(message))
        ? message
        : "Chat request failed. Check the Company is running and the selected provider is configured; retry with Protocol demo.";
    return NextResponse.json(
      { error: safe, stage },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    if (held && visitor) await releaseRun(visitor, held).catch(() => {});
    active--;
  }
}
