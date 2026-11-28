/**
 * A scripted model for the browser scenario: an OpenAI-compatible
 * `/v1/chat/completions` that answers each request by fixed rules, so the
 * scenario runs with no network, no key and the same answers every time.
 * The playground reaches it as its `openai-compatible` provider
 * (`OPENAI_BASE_URL`), so every other part of a turn is the real one:
 * routing, Iris's tools, the Companies, sign-in and approvals.
 *
 * It knows the scenario's messages and nothing else. A request is one of:
 *
 * - Iris's routing question ("which Company is this message for?"): the
 *   Company the message names, else the last turn's, else `unsure`.
 * - A turn: the rule whose words the User's message has, by how many
 *   tool results the turn has had so far: a tool call to make, then the
 *   answer.
 *   A message no rule knows is answered in one line.
 *
 * Plain Node, no dependencies, so it runs as it is (`node fake-model.ts`
 * to try it on its own).
 */
import { createServer, type Server, type ServerResponse } from "node:http";

type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null | Array<{ type: string; text?: string }>;
};
type Request = {
  messages?: Message[];
  tools?: Array<{ function?: { name?: string } }>;
  stream?: boolean;
};
type Reply = { text: string } | { call: string; args: Record<string, unknown> };

const textOf = (m: Message | undefined) =>
  typeof m?.content === "string"
    ? m.content
    : (m?.content ?? []).map((part) => part.text ?? "").join("");
/** The last of the User's messages. */
const lastUser = (messages: Message[]) =>
  messages[messages.map((m) => m.role).lastIndexOf("user")];
/** Lower case, without accents, for matching words. */
const plain = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/** The routing question's answer: one origin, or `unsure`. */
function route(prompt: string): string {
  const data = JSON.parse(prompt) as {
    companies: Array<{ origin: string; name: string }>;
    last_turn_company: string | null;
    message: string;
  };
  const message = plain(data.message);
  const named = data.companies.find((c) =>
    message.includes(plain(c.name).split(" ")[0]!),
  );
  return named?.origin ?? data.last_turn_company ?? "unsure";
}

/**
 * One rule a turn: the words of the User's message it answers, the tool
 * calls it makes in order (each after the previous one's result), and
 * the answer once they are done. A tool is found by the end of its name,
 * as a turn with several Companies puts its Company's key before it.
 */
type Rule = {
  words: RegExp;
  calls: Array<{ tool: string; args: Record<string, unknown> }>;
  answer: string;
};
const rules: Rule[] = [
  {
    // Fernwick, before any sign-in. Asking its agent opens the
    // conversation that "Talk to … yourself" starts from.
    words: /\btarifas\b/,
    calls: [
      { tool: "company_agent_send", args: { data: { request: "help" } } },
    ],
    answer:
      "Fernwick Power & Light tiene dos tarifas: la tarifa plana y la de discriminación horaria.",
  },
  {
    words: /\btarifa plana\b/,
    calls: [
      { tool: "account", args: {} },
      {
        tool: "change_plan",
        args: {
          usage_point_id: "UP-E2",
          plan: "flat",
          idempotency_key: "e2e-plan-UP-E2-flat",
        },
      },
    ],
    answer:
      "He pedido a Fernwick Power & Light el cambio del cargador a la tarifa plana.",
  },
  {
    words: /\bmenu\b/,
    calls: [
      { tool: "menu", args: {} },
      {
        tool: "company_agent_send",
        args: { data: { request: "opening_hours" } },
      },
    ],
    answer:
      "Lantern Noodle Bar tiene ramen shoyu, ramen de miso, gyoza, edamame y helado de matcha, y te dice su horario arriba.",
  },
  {
    words: /\bhelado de matcha\b/,
    calls: [
      { tool: "my_orders", args: {} },
      {
        tool: "change_order",
        args: {
          order_id: "ord_LNB1001",
          add: [{ dish_id: "matcha-ice", quantity: 1 }],
        },
      },
    ],
    answer: "He pedido a Lantern Noodle Bar que añada un helado de matcha.",
  },
];

/** The reply to one request, by the rules above. */
export function replyTo(request: Request): Reply {
  const messages = request.messages ?? [];
  const system = textOf(messages.find((m) => m.role === "system"));
  if (system.startsWith("You choose which Company"))
    return {
      text: route(textOf(lastUser(messages))),
    };
  const last = messages.map((m) => m.role).lastIndexOf("user");
  const asked = plain(textOf(messages[last]));
  // The tool results of this turn so far.
  const done = messages.slice(last + 1).filter((m) => m.role === "tool").length;
  const tools = (request.tools ?? []).flatMap((t) =>
    t.function?.name ? [t.function.name] : [],
  );
  const rule = rules.find((r) => r.words.test(asked));
  if (!rule) return { text: "De acuerdo." };
  const next = rule.calls[done];
  if (!next) return { text: rule.answer };
  const tool = tools.find(
    (name) => name === next.tool || name.endsWith(`__${next.tool}`),
  );
  if (!tool)
    throw new Error(
      `The scenario's model has no tool ${next.tool}; it was offered ${tools.join(", ")}`,
    );
  return { call: tool, args: next.args };
}

let calls = 0;
/** The reply as Chat Completions sends it: whole, or as a stream. */
function send(response: ServerResponse, reply: Reply, stream: boolean) {
  const id = `chatcmpl-e2e-${++calls}`;
  const base = { id, created: 0, model: "scenario" };
  const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
  const toolCall =
    "call" in reply
      ? {
          id: `call_e2e_${calls}`,
          type: "function" as const,
          function: { name: reply.call, arguments: JSON.stringify(reply.args) },
        }
      : undefined;
  const finish = toolCall ? "tool_calls" : "stop";
  if (!stream) {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        ...base,
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "text" in reply ? reply.text : null,
              ...(toolCall ? { tool_calls: [toolCall] } : {}),
            },
            finish_reason: finish,
          },
        ],
        usage,
      }),
    );
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  });
  const chunk = (delta: object, finish_reason: string | null, more = {}) =>
    response.write(
      `data: ${JSON.stringify({
        ...base,
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta, finish_reason }],
        ...more,
      })}\n\n`,
    );
  chunk({ role: "assistant", content: "" }, null);
  if (toolCall) chunk({ tool_calls: [{ index: 0, ...toolCall }] }, null);
  else
    for (const piece of (reply as { text: string }).text.split(/(?<=\s)/))
      chunk({ content: piece }, null);
  chunk({}, finish, { usage });
  response.end("data: [DONE]\n\n");
}

/**
 * Serves the scripted model on `port`. `log` gets one line a request:
 * what was asked and what was answered.
 */
export function startFakeModel(
  port: number,
  log: (line: string) => void = () => {},
): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.end("ok");
      return;
    }
    if (
      request.method !== "POST" ||
      !request.url?.endsWith("/chat/completions")
    ) {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (part: string) => (body += part));
    request.on("end", () => {
      try {
        const parsed = JSON.parse(body) as Request;
        const reply = replyTo(parsed);
        const user = textOf(lastUser(parsed.messages ?? []));
        log(
          `${JSON.stringify(user.slice(0, 160))} -> ${JSON.stringify(reply)}`,
        );
        send(response, reply, parsed.stream === true);
      } catch (error) {
        log(`error: ${String(error)}`);
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: String(error) } }));
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? 23900);
  void startFakeModel(port, (line) => console.log(line)).then(() =>
    console.log(`Scripted model on http://127.0.0.1:${port}/v1`),
  );
}
