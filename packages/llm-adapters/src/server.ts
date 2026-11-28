import {
  generateText,
  streamText,
  tool,
  jsonSchema,
  stepCountIs,
  type ModelMessage,
} from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { modelError, ModelRequestError } from "./errors";
import { systemPrompt } from "./prompt";
export { ModelRequestError } from "./errors";
export { systemPrompt } from "./prompt";

/**
 * Cloudflare Workers AI's binding (a Worker's `env.AI`), as much of it as
 * is used here. Its text models answer in OpenAI's `chat.completion`
 * shape, with the Neurons the call cost in `usage.neurons`.
 */
export type WorkersAiBinding = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
};

type ModelConfig = {
  apiKey?: string | undefined;
  model?: string | undefined;
  /**
   * For `workers-ai`: the deployment's binding, told what each call
   * cost. There is no key: the model runs in the Worker's own account.
   */
  workersAi?:
    | { binding: WorkersAiBinding; onUsage?: (neurons: number) => void }
    | undefined;
};

/** The Workers AI model used when none is named. */
export const WORKERS_AI_MODEL = "@cf/google/gemma-4-26b-a4b-it";
/** Conservative floor when Workers AI omits `usage.neurons`. */
const FALLBACK_MIN_NEURONS = 20;

function fallbackNeurons(usage?: {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
}): number {
  const positive = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : 0;
  const tokens =
    positive(usage?.prompt_tokens) + positive(usage?.completion_tokens);
  return Math.max(FALLBACK_MIN_NEURONS, Math.ceil(tokens / 10));
}

/**
 * The binding's stream as the OpenAI-compatible provider reads it. The
 * binding sends OpenAI's `chat.completion.chunk` events, each with the
 * Neurons of its own tokens in `usage` and padding in `p`, then one event
 * of its older shape (`{ response, usage }`) with the whole call's usage,
 * then `[DONE]`. The provider would take each chunk's `usage` as the
 * call's and can't read the older event, so both are taken out here, and
 * `report` is told what the call cost once, however the stream ends.
 */
function relayed(
  source: ReadableStream<Uint8Array>,
  report: (neurons: number) => void,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffered = "";
  let total: number | undefined;
  let parts = 0;
  const tokens = { prompt_tokens: 0, completion_tokens: 0 };
  let reported = false;
  const settle = () => {
    if (reported) return;
    reported = true;
    report(total ?? (parts > 0 ? parts : fallbackNeurons(tokens)));
  };
  const count = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : 0;
  const relay = (lines: string) => {
    let out = "";
    for (const line of lines.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") {
        out += "data: [DONE]\n\n";
        continue;
      }
      let chunk: Record<string, unknown>;
      try {
        chunk = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }
      const usage = chunk.usage as Record<string, unknown> | undefined;
      if (!Array.isArray(chunk.choices)) {
        if (count(usage?.neurons)) total = count(usage?.neurons);
        continue;
      }
      parts += count(usage?.neurons);
      tokens.prompt_tokens += count(usage?.prompt_tokens);
      tokens.completion_tokens += count(usage?.completion_tokens);
      delete chunk.usage;
      delete chunk.p;
      out += `data: ${JSON.stringify(chunk)}\n\n`;
    }
    return out;
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        // Until there is something to send: a pull that sends nothing
        // isn't called again.
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            const rest = relay(buffered + decoder.decode());
            buffered = "";
            if (rest) controller.enqueue(encoder.encode(rest));
            settle();
            controller.close();
            return;
          }
          buffered += decoder.decode(value, { stream: true });
          const end = buffered.lastIndexOf("\n");
          if (end < 0) continue;
          const out = relay(buffered.slice(0, end + 1));
          buffered = buffered.slice(end + 1);
          if (out) {
            controller.enqueue(encoder.encode(out));
            return;
          }
        }
      } catch (error) {
        settle();
        controller.error(error);
      }
    },
    cancel(reason) {
      settle();
      return reader.cancel(reason);
    },
  });
}

function abortError(signal: AbortSignal): Error {
  const { reason } = signal;
  if (
    reason instanceof Error ||
    (typeof DOMException === "function" && reason instanceof DOMException)
  ) {
    return reason;
  }
  return new DOMException(
    typeof reason === "string" && reason
      ? reason
      : "The operation was aborted.",
    "AbortError",
  );
}

/**
 * Race a promise that does not accept an `AbortSignal` (such as
 * `env.AI.run`) against `signal`. Removes the listener on settle and
 * suppresses unhandled rejections if the losing call fails later.
 */
function raceWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | null | undefined,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    promise.catch(() => {});
    return Promise.reject(abortError(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      promise.catch(() => {});
      reject(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * A `fetch` for the OpenAI-compatible provider that hands each request to
 * the Workers AI binding instead of the network. `thinking` is off for a
 * short question, whose few hundred tokens the model's reasoning would
 * otherwise use up.
 */
function workersAiFetch(
  ai: NonNullable<ModelConfig["workersAi"]>,
  thinking: boolean,
): typeof fetch {
  return async (_url, init) => {
    const signal = init?.signal;
    if (signal?.aborted) throw abortError(signal);
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      model: string;
      messages?: Array<Record<string, unknown>>;
      tools?: unknown;
      tool_choice?: unknown;
      max_tokens?: number;
      stream?: boolean;
    };
    const streaming = body.stream === true;
    const input = {
      // After a tool call the AI SDK sends the assistant's message with
      // `content: null`, which the binding refuses (error 5006).
      messages: (body.messages ?? []).map((m) =>
        m.content === null ? { ...m, content: "" } : m,
      ),
      ...(body.tools ? { tools: body.tools } : {}),
      ...(body.tool_choice ? { tool_choice: body.tool_choice } : {}),
      ...(body.max_tokens ? { max_tokens: body.max_tokens } : {}),
      ...(thinking ? {} : { chat_template_kwargs: { enable_thinking: false } }),
      ...(streaming ? { stream: true } : {}),
    };
    let raw: Record<string, unknown>;
    try {
      const answered = await raceWithSignal(
        ai.binding.run(body.model, input),
        signal,
      );
      if (streaming) {
        if (!(answered instanceof ReadableStream))
          return Response.json(
            { error: { message: "Workers AI" } },
            { status: 502 },
          );
        return new Response(
          relayed(answered as ReadableStream<Uint8Array>, (neurons) =>
            ai.onUsage?.(neurons),
          ),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      }
      raw = answered as Record<string, unknown>;
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      // The binding throws with its code in the message: 4006 is the
      // account's daily free allocation used up, 3040 no capacity now.
      const message = error instanceof Error ? error.message : "";
      const status = /\b(4006|3040)\b|allocation|capacity/i.test(message)
        ? 429
        : 502;
      return Response.json({ error: { message: "Workers AI" } }, { status });
    }
    const usage = raw?.usage as
      | {
          neurons?: unknown;
          prompt_tokens?: unknown;
          completion_tokens?: unknown;
        }
      | undefined;
    const neurons =
      typeof usage?.neurons === "number" &&
      Number.isFinite(usage.neurons) &&
      usage.neurons > 0
        ? usage.neurons
        : fallbackNeurons(usage);
    ai.onUsage?.(neurons);
    return Response.json({
      id: "workers-ai",
      object: "chat.completion",
      created: 0,
      model: body.model,
      ...raw,
    });
  };
}

/**
 * The selected provider's model, with the options its calls take. Every
 * call to a model goes through here, so each one is configured alike.
 * A `question` is a short call of its own, such as which Company a turn
 * is for. With `lowest` it asks for no reasoning at all, from OpenAI's
 * reasoning models and from Gemini, which a model may not accept:
 * `lowered` says whether anything was asked that way.
 */
function selectedModel(
  provider: string,
  config?: ModelConfig,
  use: "turn" | "question" = "turn",
  lowest = false,
) {
  const env: Record<string, string | undefined> = config?.apiKey
    ? {}
    : process.env;
  const key = config?.apiKey || undefined;
  let model;
  let useOpenAIReasoning = false;
  let useOfficialOpenAI = false;
  let useGoogleThinking = false;
  if (provider === "workers-ai") {
    if (!config?.workersAi)
      throw new Error(
        "The free model runs only on the deployed site, where Workers AI is bound.",
      );
    model = createOpenAICompatible({
      name: "workers-ai",
      // Never reached: the binding answers every call.
      baseURL: "https://workers-ai.invalid/v1",
      fetch: workersAiFetch(config.workersAi, use === "turn"),
    })(config.model || WORKERS_AI_MODEL);
  } else if (provider === "anthropic") {
    if (!(key ?? env.ANTHROPIC_API_KEY))
      throw new Error(
        "Set ANTHROPIC_API_KEY in apps/playground/.env.local, or choose Protocol demo.",
      );
    model = createAnthropic({ apiKey: (key ?? env.ANTHROPIC_API_KEY)! })(
      (config?.model || env.ANTHROPIC_MODEL) ?? "claude-sonnet-4-6",
    );
  } else if (provider === "google") {
    if (!(key ?? env.GOOGLE_GENERATIVE_AI_API_KEY))
      throw new Error(
        "Set GOOGLE_GENERATIVE_AI_API_KEY, or choose Protocol demo.",
      );
    model = createGoogleGenerativeAI({
      apiKey: (key ?? env.GOOGLE_GENERATIVE_AI_API_KEY)!,
    })((config?.model || env.GOOGLE_MODEL) ?? "gemini-2.5-flash");
    useGoogleThinking = true;
  } else if (provider === "ollama" || provider === "openai-compatible") {
    const local = provider === "ollama";
    if (!local && !(key ?? env.OPENAI_API_KEY))
      throw new Error(
        "Set OPENAI_API_KEY in apps/playground/.env.local, or choose Protocol demo.",
      );
    const baseURL = (
      local
        ? (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/v1")
        : (env.OPENAI_BASE_URL ?? "https://api.openai.com/v1")
    ).replace(/\/$/, "");
    const modelId = local
      ? ((config?.model || env.OLLAMA_MODEL) ?? "qwen3:8b")
      : ((config?.model || env.OPENAI_MODEL) ?? "gpt-4.1-mini");
    if (!local && baseURL === "https://api.openai.com/v1") {
      // Responses supports reasoning-model tool loops; generic Chat Completions does not.
      useOfficialOpenAI = true;
      model = createOpenAI({ apiKey: (key ?? env.OPENAI_API_KEY)! }).responses(
        modelId,
      );
      useOpenAIReasoning = /^(gpt-[5-9]|o[1-9])/.test(modelId);
    } else {
      model = createOpenAICompatible({
        name: provider,
        baseURL,
        apiKey: local ? "ollama" : (key ?? env.OPENAI_API_KEY)!,
      })(modelId);
    }
  } else throw new Error("Unknown model provider");
  return {
    lowered: lowest && (useOpenAIReasoning || useGoogleThinking),
    options: {
      model,
      ...(useOfficialOpenAI
        ? {
            providerOptions: {
              openai: {
                store: false,
                ...(useOpenAIReasoning
                  ? { reasoningEffort: lowest ? "none" : "low" }
                  : {}),
              },
            },
          }
        : useGoogleThinking && lowest
          ? {
              providerOptions: {
                google: { thinkingConfig: { thinkingBudget: 0 } },
              },
            }
          : {}),
    },
  };
}

export async function runModel(
  provider: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  availableTools: Record<
    string,
    {
      description: string;
      schema?: Record<string, unknown>;
      execute: (input?: Record<string, unknown>) => Promise<unknown>;
    }
  >,
  config?: ModelConfig & {
    /** The agent's name, as its channel configures it. */
    name?: string | undefined;
    /**
     * What Iris itself knows for this turn, such as whether the User is
     * signed in at the Company: never Company content. Sent after the
     * system prompt.
     */
    context?: string | undefined;
    /**
     * The most model steps the turn may take, 5 when not given. A task at
     * several Companies, read at one and proposed at another, takes more.
     */
    steps?: number | undefined;
    /**
     * The answer as the model writes it, piece by piece: the answer is
     * then streamed from every provider. What it is given, joined, is the
     * text `runModel` answers, give or take the space around it.
     */
    onText?: ((text: string) => void) | undefined;
    /**
     * The answer when the model wrote none, even asked once more: what
     * was done and what the User can do, in the conversation's language.
     */
    unanswered?: (() => string) | undefined;
  },
) {
  const { options: selected } = selectedModel(provider, config);
  // Whether a tool has run: after one, the turn can't be asked again.
  let used = false;
  const tools = Object.fromEntries(
    Object.entries(availableTools).map(([name, definition]) => [
      name,
      tool({
        description: definition.description,
        inputSchema: jsonSchema<Record<string, unknown>>(
          definition.schema ?? {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        ),
        execute: async (input) => {
          used = true;
          const result = await definition.execute(input);
          return (JSON.stringify(result) ?? "null").slice(0, 16000);
        },
      }),
    ]),
  );
  // A smaller model takes a step or two more for the same task.
  const budget = (config?.steps ?? 5) + (provider === "workers-ai" ? 2 : 0);
  const system = [systemPrompt(config?.name), config?.context]
    .filter(Boolean)
    .join("\n\n");
  const options = {
    system,
    messages,
    tools,
    // The budget's last step is kept for the answer, when the steps
    // before it called tools and wrote none (`recovered`).
    stopWhen: stepCountIs(Math.max(1, budget - 1)),
    maxOutputTokens: 1800,
    ...selected,
    maxRetries: 0,
  };
  /** What the User reads when the model wrote no answer at all. */
  const unanswered = () => config?.unanswered?.() ?? UNANSWERED;
  /**
   * The turn's answer, from what its steps wrote (`steps`, in order, each
   * with whether it called a tool) and the messages they made:
   *
   * - Steps that called tools and wrote nothing: the answer is asked for
   *   once more, in the step the budget kept, from what the tools
   *   returned, with no tool to call.
   * - A last step that says what the model is about to do ("I'll check
   *   your balance now.") and does nothing: it is asked to go on, with
   *   its tools, in the steps the budget has left.
   *
   * With no answer even then, the caller's line says what was done.
   * `more` hears what is added, for a stream.
   */
  const finish = async (
    steps: ReadonlyArray<{ text: string; called: boolean }>,
    made: () => PromiseLike<ModelMessage[]>,
    more?: (text: string) => void,
  ): Promise<string> => {
    const text = said(steps.map((s) => s.text));
    const last = steps.at(-1);
    const stalled = !!text && !!last && !last.called && promises(last.text);
    if (text && !stalled) return text;
    const left = budget - steps.length;
    const added =
      left > 0 && (used || stalled)
        ? await generateText({
            ...options,
            system: `${system}\n\n${stalled ? GO_ON : ANSWER_NOW}`,
            messages: [...messages, ...(await made())],
            stopWhen: stepCountIs(left),
            ...(stalled ? {} : { toolChoice: "none" as const }),
            abortSignal: AbortSignal.timeout(30000),
          })
            .then((response) => said(response.steps.map((s) => s.text)))
            .catch(() => "")
        : "";
    const late = added || unanswered();
    if (late) more?.(late);
    return said([text, late]);
  };
  const whole = async () => {
    const timeoutSignal = AbortSignal.timeout(60000);
    const response = await generateText({
      ...options,
      abortSignal: timeoutSignal,
    }).catch((error: unknown) => {
      throw modelError(
        timeoutSignal.aborted ? abortError(timeoutSignal) : error,
        provider,
      );
    });
    return finish(
      response.steps.map((step) => ({
        text: step.text,
        called: step.toolCalls.length > 0,
      })),
      async () => response.steps.flatMap((step) => step.response.messages),
    );
  };
  if (!config?.onText) return whole();
  const onText = config.onText;
  // What the model wrote at each step: a line before it calls a tool
  // ("I'll look at your orders.") is part of the answer, as it was heard.
  const written: Array<{ text: string; called: boolean }> = [];
  let step = "";
  let called = false;
  const nothing = () =>
    !used && !step.trim() && !written.some((t) => t.text.trim());
  // The messages each step made, once the stream is over, for `finish`.
  let made: (() => PromiseLike<ModelMessage[]>) | undefined;
  const timeoutSignal = AbortSignal.timeout(60000);
  try {
    const result = streamText({
      ...options,
      abortSignal: timeoutSignal,
    });
    made = async () =>
      (await result.steps).flatMap((step) => step.response.messages);
    for await (const part of result.fullStream) {
      if (part.type === "error") throw part.error;
      if (part.type === "abort") {
        throw timeoutSignal.aborted
          ? abortError(timeoutSignal)
          : new DOMException("The operation was aborted.", "AbortError");
      }
      if (part.type === "text-delta" && part.text) {
        step += part.text;
        onText(part.text);
      } else if (part.type === "tool-call") {
        called = true;
      } else if (part.type === "finish-step") {
        written.push({ text: step, called });
        // The step's last sentence is whole now, and the next step's
        // words are a paragraph of their own.
        if (step.trim()) onText("\n\n");
        step = "";
        called = false;
      }
    }
    if (timeoutSignal.aborted) {
      throw abortError(timeoutSignal);
    }
  } catch (error) {
    const failed = modelError(
      timeoutSignal.aborted ? abortError(timeoutSignal) : error,
      provider,
    );
    // A stream that failed before anything was said or done is asked
    // again as a whole answer: a provider may not stream, or not here.
    // One the provider refused, or that ran out of time, is not.
    if (
      !nothing() ||
      [
        "provider_auth",
        "provider_access",
        "provider_quota",
        "provider_timeout",
      ].includes(failed.code)
    )
      throw failed;
    return whole();
  }
  // A stream that ended with nothing in it, from a provider that answered
  // a stream with something else, is asked again the same way.
  if (nothing()) return whole();
  return finish(written, made!, onText);
}

/**
 * The last sentence of a step that says what the model is about to do,
 * in the languages Iris speaks: "I'll check your balance now.", "Voy a
 * revisarlo.", "Je vais vérifier.". Not "Let me know if …".
 */
const PROMISE =
  /^(?:(?:ok|okay|sure|alright|vale|claro|d'acord|d'accord|bien|perfecto|perfect)[,!.]?\s+)?(?:i'?ll\b|i will\b|let me (?!know)|i'?m going to\b|one moment|just a (?:moment|sec)|voy a\b|d[ée]jame\b|un momento|ahora (?:mismo )?(?:lo |la )?(?:compruebo|reviso|miro|consulto|busco)|vaig a\b|deixa'?m\b|un moment\b|ara (?:ho |el |la )?(?:comprovo|miro|consulto|busco)|je vais\b|laisse[sz]?-moi\b|un instant|je (?:regarde|v[ée]rifie|consulte|cherche)\b)/i;

const promises = (text: string) => {
  const sentences = text
    .trim()
    .split(/(?<=[.!?…:])\s+/)
    .filter(Boolean);
  return PROMISE.test(sentences.at(-1) ?? "");
};

/**
 * Asked of the model, once, when the turn's steps called tools and wrote
 * no answer: Iris's own words, never Company content.
 */
const ANSWER_NOW =
  "Your steps so far called tools and wrote no answer. Answer the user now, in their language, from what the tools returned in this turn: what you found or did, and the next step if there is one. Don't call a tool.";

/** Asked once, when the turn's last step said what it would do and stopped. */
const GO_ON =
  "Your last step said what you were about to do and stopped there. Do it now with the tools, then answer the user, in their language, with what they returned. Don't say again what you're about to do.";

/**
 * The answer to a turn the model wrote nothing of, when the caller gives
 * none of its own: it says what happened and what the User can do.
 */
const UNANSWERED =
  "I made the requests for this, but no answer came out of them. Ask me again, or tell me in other words what you'd like done.";

/** A model's answer: the words of each step, a paragraph each. */
const said = (steps: string[]) =>
  steps
    .map((text) => text.trim())
    .filter(Boolean)
    .join("\n\n");

/**
 * One short answer from the selected model, with no tools and no turns
 * before it: for a choice Iris makes before a turn, such as which Company
 * the turn is for. The caller writes the instructions and reads the
 * answer; it is bounded in time and length.
 *
 * Its answer is a line, so it is asked for with no reasoning and a few
 * tokens: a reasoning model's tokens for its reasoning count against the
 * same limit, and at the turn's effort its reasoning alone can use them
 * all, and the time, before it writes the line. A model that refuses to
 * be asked without reasoning is asked once more at the turn's effort,
 * with room for its reasoning, in the time that is left.
 */
export async function askModel(
  provider: string,
  question: { system: string; prompt: string },
  config?: ModelConfig,
  limits: { timeout: number; maxOutputTokens: number; reasoning?: number } = {
    timeout: 10000,
    maxOutputTokens: 64,
    reasoning: 1024,
  },
) {
  const deadline = AbortSignal.timeout(limits.timeout);
  const ask = (lowest: boolean) => {
    const { options, lowered } = selectedModel(
      provider,
      config,
      "question",
      lowest,
    );
    return {
      lowered,
      answer: generateText({
        system: question.system,
        prompt: question.prompt,
        maxOutputTokens: lowest
          ? limits.maxOutputTokens
          : limits.maxOutputTokens + (limits.reasoning ?? 0),
        ...options,
        abortSignal: deadline,
        maxRetries: 0,
      }).catch((error: unknown) => {
        throw modelError(
          deadline.aborted ? abortError(deadline) : error,
          provider,
        );
      }),
    };
  };
  const first = ask(true);
  try {
    return (await first.answer).text;
  } catch (error) {
    if (
      !first.lowered ||
      !(error instanceof ModelRequestError) ||
      error.code !== "provider_request"
    )
      throw error;
    return (await ask(false).answer).text;
  }
}
