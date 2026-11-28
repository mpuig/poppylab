/**
 * End to end, in process, with a model: one conversation at Lantern in
 * Spanish, as a person had it on 28 November. A read, a change that needs
 * the sign-in, the sign-in and "sí, sigue", the change permission asked for
 * in words, then the change itself. Only the network and the model are
 * replaced: the model is a script that calls Lantern's own tools and
 * answers as a real one did.
 *
 * The change permission is a second consent, and Lantern's page lets the
 * person choose another customer. Iris used only Lantern's API, so no
 * conversation with its agent can say whose the new sign-in is; the
 * Session the earlier sign-in used does (§5.4). For Elena again, every
 * turn stays as it was, for the page and the model. For Robin, every turn
 * the person saw stays on the page, marked as the earlier sign-in's, and
 * the model is sent only what was said before any account access.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
type App = {
  request: (url: string, init?: RequestInit) => Response | Promise<Response>;
};
type Tools = Record<
  string,
  { execute: (input?: Record<string, unknown>) => Promise<unknown> }
>;
type Script = (
  tools: Tools,
  messages: Array<{ role: string; content: string }>,
) => Promise<string>;
const net = vi.hoisted(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("PAP_ALLOW_PRIVATE_NETWORK", "true");
  return {
    apps: {} as Record<string, App>,
    cookies: new Map<string, string>(),
  };
});
/** The model: the next script for each turn, and what each turn was sent. */
const model = vi.hoisted(() => ({
  next: [] as Script[],
  sent: [] as Array<Array<{ role: string; content: string }>>,
}));
vi.mock("@poppy-lab/llm-adapters/server", async (actual) => ({
  ...(await actual<typeof import("@poppy-lab/llm-adapters/server")>()),
  runModel: async (
    _provider: string,
    messages: Array<{ role: string; content: string }>,
    tools: Tools,
  ) => {
    model.sent.push(messages);
    const script = model.next.shift();
    if (!script) throw new Error("The model wasn't expected here");
    return script(tools, messages);
  },
}));
vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "127.0.0.1", family: 4 }],
}));
const undici = await vi.hoisted(async () => {
  const { createRequire } = await import("node:module");
  const { fileURLToPath } = await import("node:url");
  return createRequire(
    fileURLToPath(new URL("../../../packages/pap-client/", import.meta.url)),
  ).resolve("undici");
});
vi.mock(undici, () => ({
  Agent: class {
    destroy() {}
  },
  fetch: async (
    url: URL | string,
    init: RequestInit & { dispatcher?: unknown },
  ) => {
    const { dispatcher, ...rest } = init;
    void dispatcher;
    return net.apps[new URL(String(url)).origin]!.request(String(url), rest);
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      net.cookies.has(name) ? { value: net.cookies.get(name)! } : undefined,
    set: (name: string, value: string, options?: { maxAge?: number }) => {
      if (value && options?.maxAge !== 0) net.cookies.set(name, value);
      else net.cookies.delete(name);
    },
    delete: (name: string) => net.cookies.delete(name),
  }),
}));
import { createIdentity } from "@poppy-lab/pap-client";
import * as lantern from "../../lantern/src/test-harness";
import { POST as discover } from "../app/api/discover/route";
import { GET as account, POST as act } from "../app/api/account/route";
import { GET as callback } from "../app/api/account/callback/route";
import { POST as chat } from "../app/api/chat/route";
import { yesOrNo, SAYS_YES } from "@poppy-lab/pap-agent/typed-answers";
import type { Operation } from "@poppy-lab/pap-agent/runtime";

const agent = "http://localhost:3000";
const food = lantern.origin;
let conversation = "";

const post = async (
  handler: (r: Request) => Promise<Response>,
  path: string,
  body: unknown,
) => {
  const response = await handler(
    new Request(`${agent}${path}`, {
      method: "POST",
      headers: {
        origin: agent,
        "Content-Type": "application/json",
        ...(conversation ? { "X-Poppy-Conversation": conversation } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
  return {
    status: response.status,
    conversation: response.headers.get("X-Poppy-Conversation"),
    data: await response.json(),
  };
};
/** What the User types, with a model answering. */
const say = (message: string, script?: Script) => {
  if (script) model.next.push(script);
  return post(chat, "/api/chat", {
    message,
    provider: "ollama",
    companies: true,
  });
};
type Entry = {
  role: string;
  content: string;
  earlier?: true;
  choices?: Array<{ label: string; answer: Record<string, unknown> }>;
  proposals?: unknown[];
};
const reload = async () =>
  (
    await account(
      new Request(`${agent}/api/account?conversation=${conversation}`),
    )
  ).json() as Promise<{
    history: Entry[];
    language: string;
    connections: Array<{ origin: string; operations: Operation[] }>;
  }>;

/** Elena on Lantern's consent page, allowing what Iris asked. */
async function consent(url: string, form: object = {}) {
  const app = net.apps[food]!;
  const page = await app.request(url);
  expect(page.status).toBe(200);
  const cookie = page.headers
    .getSetCookie()
    .find((c) => c.includes("pap_consent_"))!
    .split(";")[0]!;
  const allowed = await app.request(`${food}/oauth/authorize`, {
    method: "POST",
    headers: {
      cookie,
      origin: food,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      nonce: cookie.split("=")[1]!,
      decision: "approve",
      account: "elena",
      ...form,
    }).toString(),
  });
  expect(allowed.status).toBe(302);
  const back = await callback(new Request(allowed.headers.get("location")!));
  expect(back.headers.get("Location")).toBe("/playground/sign-in/done");
}

/** The change, as a model asks Lantern for it: read the order, then propose. */
const change = async (tools: Tools) => {
  await tools.my_orders?.execute({});
  return tools.change_order!.execute({
    order_id: "ord_LNB1001",
    slot_id: "sun-1300",
    add: [{ dish_id: "matcha-ice", quantity: 1 }],
  });
};

describe("a change permission given after the sign-in, in Spanish", () => {
  beforeAll(async () => {
    const keys = await createIdentity();
    vi.stubEnv("POPPY_IDENTITY", JSON.stringify(keys));
    const fetchJson = async (url: string) =>
      url.endsWith("client.json")
        ? {
            client_id: lantern.client,
            client_name: "Iris",
            jwks_uri: `${agent}/agent/jwks.json`,
            redirect_uris: [lantern.redirect],
          }
        : { keys: [keys.publicKey] };
    await lantern.setup({ fetchJson });
    net.apps[food] = lantern.lab.app;
    net.cookies.set("poppy_visitor", "l".repeat(43));
  });

  /** Every line the page showed, up to the change permission. */
  const shownBefore: string[] = [];

  it("reads, then asks to sign in for the change", async () => {
    const found = await post(discover, "/api/discover", { url: food });
    conversation = found.conversation!;
    const menu = await say(
      "hola, ¿qué tiene Lantern Noodle Bar en el menú?",
      async (tools) => {
        await tools.menu!.execute({});
        return "Tiene ramen shoyu, gyoza y helado de matcha, entre otros.";
      },
    );
    expect(menu.status).toBe(200);
    const asked = await say(
      "quiero añadir un helado de matcha a mi pedido y pasarlo al domingo a mediodía",
      async (tools) => {
        await change(tools);
        return "Para cambiar tu pedido tienes que iniciar sesión en Lantern Noodle Bar.";
      },
    );
    expect(asked.data.question.choices[0].answer).toEqual({
      signin: { company: food, access: "read" },
    });
  });

  it("signs in, goes on, and asks for the change permission in its own question", async () => {
    const started = await post(act, "/api/account", {
      action: "signin",
      company: food,
      access: "read",
      said: "sí",
    });
    expect(started.status).toBe(200);
    await consent(started.data.url);
    expect((await reload()).history.at(-1)!.content).toBe(
      "Ya has iniciado sesión en Lantern Noodle Bar. ¿Sigo con «quiero añadir un helado de matcha a mi pedido y pasarlo al domingo a mediodía»?",
    );
    // "sí, sigue" sends the request that waited to the model.
    const turn = await say("sí, sigue", async (tools) => {
      await change(tools);
      return "Te falta el permiso para hacer cambios en Lantern Noodle Bar; puedes elegir «Request change permission».";
    });
    expect(turn.status).toBe(200);
    // Iris asks for the permission in its own words, so a "sí" works.
    expect(turn.data.question.text).toBe(
      "¿Pido a Lantern Noodle Bar permiso para hacer cambios y seguir con «quiero añadir un helado de matcha a mi pedido y pasarlo al domingo a mediodía»? Se vuelve a abrir la página de Lantern Noodle Bar, y nada cambia hasta que apruebes el cambio en sí.",
    );
    expect(turn.data.question.choices[0].answer).toEqual({
      signin: { company: food, access: "write" },
    });
    // Asked for in words, in Spanish: the page reads it as yes.
    expect(yesOrNo("vale, pide el permiso", SAYS_YES.signin)).toBe("yes");
    shownBefore.push(...(await reload()).history.map((e) => e.content));
  });

  it("keeps the whole conversation once the change permission is given for the same customer, after a reload too", async () => {
    model.next.length = 0;
    const started = await post(act, "/api/account", {
      action: "signin",
      company: food,
      access: "write",
      said: "vale, pide el permiso",
    });
    expect(started.status).toBe(200);
    await consent(started.data.url, { write: "yes" });
    const { history, language } = await reload();
    expect(language).toBe("es");
    const shown = history.map((e) => e.content);
    // Nothing the page showed before is gone, in its order.
    expect(shown.slice(0, shownBefore.length)).toEqual(shownBefore);
    for (const words of [
      "Ya has iniciado sesión en Lantern Noodle Bar.",
      "Te falta el permiso para hacer cambios",
      "vale, pide el permiso",
    ])
      expect(shown.some((line) => line.includes(words))).toBe(true);
    // The Session Elena's first sign-in used took the new token: it is her
    // account, and nothing is marked as another sign-in's.
    expect(history.some((e) => e.earlier)).toBe(false);
    const { log } = (await (
      await account(
        new Request(`${agent}/api/account?conversation=${conversation}`),
      )
    ).json()) as { log: Array<{ text: string }> };
    expect(log.map((l) => l.text)).toContain(
      "Same account · the earlier sign-in's Session took the new token",
    );
    // The request that waited is asked about again, with its button.
    expect(history.at(-1)).toMatchObject({
      content:
        "Ya has iniciado sesión en Lantern Noodle Bar. ¿Sigo con «quiero añadir un helado de matcha a mi pedido y pasarlo al domingo a mediodía»?",
      choices: [{ label: "Sí, sigue", answer: { resume: food } }],
    });
    expect(history.at(-1)!.earlier).toBeUndefined();
  });

  it("goes on with the model's whole context, and says each term once", async () => {
    model.next.push(async (tools) => {
      await change(tools);
      return "Lantern Noodle Bar tiene listo el cambio: añade un Matcha ice cream y pasa el pedido al domingo a las 13:00. El total sube de $37.00 a $43.00; aprueba estos términos si te parecen bien.";
    });
    const turn = await post(chat, "/api/chat", {
      answer: { resume: food },
      provider: "ollama",
      companies: true,
    });
    expect(turn.status).toBe(200);
    const sent = JSON.stringify(model.sent.at(-1));
    expect(sent).toContain("¿qué tiene Lantern Noodle Bar en el menú?");
    expect(sent).toContain("Te falta el permiso");
    // Said once: the question names the terms, the answer doesn't.
    const op = turn.data.operations[0] as Operation;
    expect(op.state).toBe("proposed");
    expect(turn.data.text).toBe("He pedido el cambio, y aquí lo tienes.");
    expect(turn.data.question.text).toMatch(
      /^Lantern Noodle Bar quiere cambiar tu pedido: añadir 1 × Matcha ice cream, y la franja de entrega del viernes a las 18:30 al domingo a las 13:00\. El total nuevo es de \$\d+\.\d\d, \$\d+\.\d\d más que antes\. Caduca en 10 minutos\. ¿Lo apruebo\?$/,
    );
    // A typed yes approves it, and Iris names Lantern once.
    const approved = await post(chat, "/api/chat", {
      message: "sí",
      provider: "ollama",
      companies: true,
    });
    expect(approved.data.text).toMatch(
      /^Hecho\. Has aprobado el cambio de \$\d+\.\d\d en Lantern Noodle Bar y ya está hecho\.$/,
    );
    expect(approved.data.text.match(/Lantern Noodle Bar/g)).toHaveLength(1);
  });

  it("no longer asks about a change its standing instruction approved", async () => {
    model.next.push(async (tools) => {
      await tools.change_order!.execute({
        order_id: "ord_LNB1001",
        add: [{ dish_id: "matcha-ice", quantity: 1 }],
      });
      return "Lantern Noodle Bar tiene listo el cambio.";
    });
    const turn = await say("añade otro helado de matcha");
    expect(turn.data.question.text).toMatch(/¿Lo apruebo\?$/);
    const op = (turn.data.operations as Operation[]).find(
      (o) => o.state === "proposed",
    )!;
    // The page approves it on the User's $50 instruction, as it does.
    const approved = await post(act, "/api/account", {
      action: "approve",
      company: food,
      id: op.operation_id,
      revision: op.revision,
      instruction: { maxCents: 5000, currency: "USD" },
    });
    expect(approved.status).toBe(200);
    expect(approved.data.operation).toMatchObject({
      state: "succeeded",
      approvedBy: { approver: "agent" },
    });
    // Iris says what it did where it asked; the card stays there.
    const said = `Tu instrucción permanente cubre el cambio de $${(Number(op.terms!.new_total_cents) / 100).toFixed(2)} en Lantern Noodle Bar, así que he dado la aprobación por ti.`;
    expect(approved.data.history.at(-1)).toMatchObject({ content: said });
    const last = (await reload()).history.at(-1)!;
    expect(last).toMatchObject({
      content: said,
      proposals: [expect.objectContaining({ proposal: op.operation_id })],
    });
    expect(last.choices).toBeUndefined();
    expect(JSON.stringify((await reload()).history)).not.toContain(
      turn.data.question.text,
    );
  });
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("a change permission given as another customer", () => {
  it("keeps what the page showed, marked as the earlier sign-in's, and sends the model only the public part", async () => {
    net.cookies.set("poppy_visitor", "r".repeat(43));
    conversation = "";
    const found = await post(discover, "/api/discover", { url: food });
    conversation = found.conversation!;
    await say("hola, ¿qué tiene el menú?", async (tools) => {
      await tools.menu!.execute({});
      return "Tiene ramen shoyu y gyoza.";
    });
    const read = await post(act, "/api/account", {
      action: "signin",
      company: food,
      access: "read",
    });
    await consent(read.data.url);
    await say("¿cuándo llega mi pedido?", async (tools) => {
      await tools.my_orders!.execute({});
      return "Tu pedido llega el viernes a las 18:30.";
    });
    const write = await post(act, "/api/account", {
      action: "signin",
      company: food,
      access: "write",
    });
    // Robin, not Elena, on Lantern's own page.
    await consent(write.data.url, { write: "yes", account: "robin" });
    const { history } = await reload();
    const marked = (words: string) =>
      history.find((e) => e.content.includes(words));
    // The person's own view stays: the public turn as it was, the earlier
    // sign-in's marked as its.
    expect(marked("Tiene ramen shoyu")!.earlier).toBeUndefined();
    expect(marked("¿cuándo llega mi pedido?")).toMatchObject({ earlier: true });
    expect(marked("Tu pedido llega el viernes")).toMatchObject({
      earlier: true,
    });
    const { log } = (await (
      await account(
        new Request(`${agent}/api/account?conversation=${conversation}`),
      )
    ).json()) as { log: Array<{ text: string }> };
    expect(log.map((l) => l.text)).toContain(
      "Another account · the earlier sign-in's Session refused the new token (session_ended)",
    );
    // The model is never sent what Elena's sign-in read.
    await say("¿y ahora?", async () => "Dime qué necesitas.");
    const sent = JSON.stringify(model.sent.at(-1));
    expect(sent).toContain("hola, ¿qué tiene el menú?");
    expect(sent).not.toContain("viernes a las 18:30");
  });
});
