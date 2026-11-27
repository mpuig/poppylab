import { it, expect, vi, beforeEach } from "vitest";
const transport = vi.hoisted(() =>
  vi
    .fn<(url: string, ...args: unknown[]) => Promise<unknown>>()
    .mockResolvedValue({ state: "succeeded" }),
);
const rediscover = vi.hoisted(() => vi.fn());
vi.mock("@poppy-lab/pap-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poppy-lab/pap-client")>()),
  protocolRequest: transport,
  discoverCompany: rediscover,
}));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => {
    throw Object.assign(new Error("fixture missing"), { code: "ENOENT" });
  }),
}));
import { ProtocolError, createIdentity, type JWK } from "@poppy-lab/pap-client";
import {
  connect,
  excludedTasksTool,
  feedbackTool,
  papRequest,
} from "./runtime";
import {
  askedHere,
  askedOfLantern,
  callEach,
  refusedAt,
} from "./addressed-fixture";
import { example, headersOf } from "./runtime-fixture";

/** A turn whose request names no Company: it is the turn's Company's. */
const asked = { asked: "", companies: () => [], chosen: [] };

let dpop: JWK;
beforeEach(async () => {
  transport.mockReset().mockResolvedValue({ ok: true });
  dpop = (await createIdentity()).privateKey;
});

it("reports an unsupported task once per Session, with the token when signed in, and reads an alternative as Company content (§9.3)", async () => {
  const r = example();
  r.dpop = dpop;
  const endpoint = "https://food.papsandbox.com/poppy/feedback";
  r.tasks = {
    sid: "",
    value: {
      excludedTasks: [{ task: "Cancel an order" }],
      feedbackEndpoint: endpoint,
      skills: [],
    },
  };
  const trace: string[] = [];
  const tool = feedbackTool(r, trace, asked);
  const report = {
    task: "Pay with a gift card",
    description: "No API takes one.",
  };
  transport.mockReset().mockResolvedValueOnce({
    instructions: "Call us.",
    references: [
      { type: "web", url: "https://food.papsandbox.com/help" },
      { type: "web", url: "https://elsewhere.example/help" },
      {
        type: "openapi",
        url: "https://other.example/openapi.json",
        operation_id: "x",
      },
    ],
  });
  expect(await tool.execute(report)).toEqual({
    sent: true,
    untrusted_company_content: true,
    alternative: {
      instructions: "Call us.",
      references: [{ type: "web", url: "https://food.papsandbox.com/help" }],
    },
  });
  const [url, init, , dpopArg, options] = transport.mock.calls[0]!;
  expect(url).toBe(endpoint);
  expect(JSON.parse(String((init as RequestInit).body))).toEqual(report);
  const h = headersOf(transport.mock.calls[0]!);
  expect(h["Poppy-Session"]).toBeTruthy();
  expect(h.Authorization).toBe("DPoP access-1");
  expect(dpopArg).toMatchObject({ token: "access-1" });
  expect(options).toEqual({ acceptEmpty: true });
  expect(trace.at(-1)).toContain("200 with an alternative");

  // The same task again: not sent. An excluded task or identifiers: not sent.
  for (const input of [
    { ...report, task: "pay with a GIFT card" },
    { task: "Cancel an order", description: "Wanted to." },
    { task: "Refund", description: "Order ord_LNB0907 was missing a bowl." },
    { task: "Refund", description: "Email elena@example.com about it." },
    { task: "Refund", description: "Call +1 555 0142 about it." },
  ])
    expect(await tool.execute(input)).toMatchObject({ sent: false });
  expect(transport).toHaveBeenCalledTimes(1);

  // A 202 (null from the transport): sent, no alternative.
  transport.mockResolvedValueOnce(null);
  expect(
    await tool.execute({
      task: "Choose a spice level",
      description: "Per bowl.",
    }),
  ).toEqual({ sent: true });
  // A new Session may report the first task again.
  delete r.sessionId;
  transport.mockResolvedValueOnce(null);
  expect(await tool.execute(report)).toEqual({ sent: true });
});

it("sends a report with a date, a time, an amount or the name of one of the Company's tools, and refuses anything else that could be an identifier (§9.3)", async () => {
  const report = (description: string, task = "Change it") => {
    const r = example();
    r.dpop = dpop;
    r.tasks = {
      sid: "",
      value: {
        excludedTasks: [],
        feedbackEndpoint: "https://food.papsandbox.com/poppy/feedback",
        skills: [],
      },
    };
    const tools = new Set(["change_order", "my_basket"]);
    return feedbackTool(r, [], asked, tools).execute({ task, description });
  };
  transport.mockReset().mockResolvedValue(null);
  for (const description of [
    "Move the order to 2026-12-01; the change_order tool has no date field.",
    "The my_basket tool lists the basket; nothing in it takes a note.",
    "Transfer 10 000 000 in one payment, or 1 000 000 000 in ten.",
    "Pay $1,250.00 now and 1250000.00 EUR later.",
    "Deliver between 18.00-20.00 from 2026-12-01 to 2026-12-05.",
    "Deliver on 01.12.2026 between 18:00-20:00.",
    "Move flight 402 on 2027-05-18 09:30 (UTC+1) to 2027-05-19.",
    "Start at 2027-05-18T09:30:00+01:00.",
  ])
    expect(await report(description), description).toEqual({ sent: true });
  // The task ends in a date and the description starts with a number.
  expect(await report("2 bowls were wanted.", "Deliver on 2026-12-01")).toEqual(
    { sent: true },
  );
  transport.mockClear();
  for (const description of [
    "Email elena@example.com about it.",
    "Call +1 555 0142 about it.",
    "Call (555) 010-0142 about it.",
    "Call 555.010.0142 about it.",
    "Call 020 7946 0958 about it.",
    "Call 06 12 34 56 78 about it.",
    "Call 612 345 678 about it.",
    "Card 4417 1234 5678 9010 was declined.",
    "The form asked for 123-45-6789.",
    "Account 12345678 can't be closed.",
    "Order ord_LNB1001 was missing a bowl.",
    "Order ORD_LNB1001 was missing a bowl.",
    "Account acc_A100 can't be closed.",
    "Recipient rcp_2 can't be edited.",
    "Operation op_x7kq expired.",
    "Case case_QmFzZWxpbmVkYXRh stayed open.",
    "Booking NW7K2P can't be moved.",
    // A phone or account number in any layout, not only the common ones.
    "Call 612 34 56 78",
    "Call 91 123 45 67",
    "Call 44 20 7946 0958",
    "Call 34 612 345 678 about it.",
    "Sort code 12-34-56 account 1234 5678",
    "Sort code 12-34-56.",
    "Account 1234 5678 can't be closed.",
    // A number that only starts or ends like a date, a time or an amount.
    "The form asked for 1990-05-17-1234.",
    "Call 12.34 56 78 about it.",
    "Call 617 000 0001 about it.",
    // An ID in small letters, and a name that isn't one of the tools.
    "Account acc_checking",
    "User usr_elena",
    "sess_abcdef",
    "Pay with a gift_card at check_out.",
  ])
    expect(await report(description), description).toMatchObject({
      sent: false,
      reason: expect.stringContaining("without identifiers"),
    });
  expect(transport).not.toHaveBeenCalled();
});

it("lets a report name the tools this run offers, and no other (§9.3)", async () => {
  const r = example("shop", false);
  const tasks = "https://shop.papsandbox.com/poppy/tasks";
  const feedback = "https://shop.papsandbox.com/poppy/feedback";
  r.company!.profile.tasksEndpoint = tasks;
  vi.stubEnv("PAP_ACCOUNT_ORIGINS", "https://shop.papsandbox.com");
  try {
    rediscover.mockResolvedValueOnce(r.company!);
    transport.mockImplementation(async (url) =>
      url === tasks
        ? { excluded_tasks: [], feedback: { endpoint: feedback } }
        : url === feedback
          ? null
          : { paths: { "/orders": { get: { operationId: "my_orders" } } } },
    );
    const tools = await connect(r, [], [], asked);
    expect(tools.my_orders).toBeTruthy();
    const sends = () =>
      transport.mock.calls.filter(([url]) => url === feedback).length;
    expect(
      await tools.report_unsupported_task!.execute({
        task: "Reorder",
        description: "The my_orders tool lists orders; none places one again.",
      }),
    ).toEqual({ sent: true });
    expect(sends()).toBe(1);
    expect(
      await tools.report_unsupported_task!.execute({
        task: "Close an account",
        description: "The my_account tool isn't offered here.",
      }),
    ).toMatchObject({ sent: false });
    expect(sends()).toBe(1);
  } finally {
    vi.unstubAllEnvs();
  }
});

it("reads the tasks again when a new Session started during the turn, before listing or reporting (§9)", async () => {
  const r = example("food", false);
  const products = "https://food.papsandbox.com/poppy/products";
  const tasks = "https://food.papsandbox.com/poppy/tasks";
  const feedback = "https://food.papsandbox.com/poppy/feedback";
  r.company!.profile.tasksEndpoint = tasks;
  transport.mockImplementation(async (url) =>
    url === tasks
      ? {
          excluded_tasks: [{ task: "Cancel an order" }],
          feedback: { endpoint: feedback },
        }
      : null,
  );
  const tasksReads = () =>
    transport.mock.calls.filter(([url]) => url === tasks).length;
  // As connect leaves the run: tasks read for the Session the turn began in.
  await papRequest(r, products, "GET");
  r.tasks = {
    sid: r.sessionId!,
    value: {
      excludedTasks: [{ task: "Cancel an order" }],
      feedbackEndpoint: feedback,
      skills: [],
    },
  };
  const trace: string[] = [];
  const excluded = excludedTasksTool(r, trace);
  const report = feedbackTool(r, trace, asked);
  const listed = {
    untrusted_company_content: true,
    tasks: [{ task: "Cancel an order" }],
  };
  expect(await excluded.execute()).toEqual(listed);
  expect(tasksReads()).toBe(0);
  // An API call finds the Session ended: a new one, without the old tasks.
  const endSession = async () => {
    transport.mockRejectedValueOnce(new ProtocolError(400, "session_ended"));
    await papRequest(r, products, "GET");
    expect(r.tasks).toBeUndefined();
  };
  await endSession();
  expect(await excluded.execute()).toEqual(listed);
  expect(r.tasks?.sid).toBe(r.sessionId);
  // The same Session reuses them, and an excluded task still isn't reported.
  expect(
    await report.execute({ task: "Cancel an order", description: "Asked." }),
  ).toMatchObject({ sent: false, reason: expect.stringContaining("excluded") });
  expect(tasksReads()).toBe(1);
  await endSession();
  expect(
    await report.execute({ task: "Cancel an order", description: "Asked." }),
  ).toMatchObject({ sent: false, reason: expect.stringContaining("excluded") });
  await endSession();
  expect(
    await report.execute({
      task: "Pay with a gift card",
      description: "No API takes one.",
    }),
  ).toEqual({ sent: true });
  expect(tasksReads()).toBe(3);
});

it("sends no report, Session header or token to a feedback endpoint outside the Company's domain", async () => {
  const report = {
    task: "Pay with a gift card",
    description: "No API takes one.",
  };
  const reportTo = (endpoint: string) => {
    const r = example();
    r.dpop = dpop;
    r.tasks = {
      sid: "",
      value: { excludedTasks: [], feedbackEndpoint: endpoint, skills: [] },
    };
    return feedbackTool(r, [], asked).execute(report);
  };
  for (const endpoint of [
    "https://collector.example/x",
    "https://food.papsandbox.com.collector.example/poppy/feedback",
    "https://notfood.papsandbox.com/poppy/feedback",
    "https://food.papsandbox.com:8443/poppy/feedback",
  ])
    expect(await reportTo(endpoint)).toMatchObject({ sent: false });
  expect(transport).not.toHaveBeenCalled();
  // A subdomain is the Company's own, and gets the token as before.
  transport.mockResolvedValueOnce(null);
  expect(
    await reportTo("https://api.food.papsandbox.com/poppy/feedback"),
  ).toEqual({ sent: true });
  expect(headersOf(transport.mock.calls[0]!).Authorization).toBe(
    "DPoP access-1",
  );
});

/** The shop with its API, its agent, excluded tasks and feedback. */
function shopWithEverything() {
  const r = example("shop", false);
  const origin = "https://shop.papsandbox.com";
  r.company!.profile.tasksEndpoint = `${origin}/poppy/tasks`;
  r.company!.document.agent = {
    protocols: [{ type: "poppy", endpoint: `${origin}/poppy/agent` }],
  } as NonNullable<typeof r.company>["document"]["agent"];
  rediscover.mockResolvedValue(r.company!);
  transport.mockImplementation(async (url) =>
    url === `${origin}/poppy/tasks`
      ? {
          excluded_tasks: [{ task: "Close an account" }],
          feedback: { endpoint: `${origin}/poppy/feedback` },
        }
      : url === `${origin}/poppy/openapi.json`
        ? { paths: { "/orders": { get: { operationId: "my_orders" } } } }
        : { ok: true },
  );
  return { r, origin };
}

it("sends nothing with any tool to a Company the User's request wasn't asked of, and tells the model why", async () => {
  vi.stubEnv("PAP_ACCOUNT_ORIGINS", "https://shop.papsandbox.com");
  try {
    const { r, origin } = shopWithEverything();
    // "conéctate con lantern noodle bar", in a conversation with the shop
    // alone: the turn went to the shop for want of another.
    const trace: string[] = [];
    const tools = await connect(r, trace, [], askedOfLantern(origin, "shop"));
    // Each kind: the API's, the Company's agent's, the tasks' and feedback.
    expect(Object.keys(tools).sort()).toEqual([
      "company_agent_cancel_handoff",
      "company_agent_handoff",
      "company_agent_read",
      "company_agent_send",
      "excluded_tasks",
      "my_orders",
      "report_unsupported_task",
    ]);
    const sent = transport.mock.calls.length;
    expect(await callEach(tools)).toEqual(
      Object.keys(tools).map((name) => [name, refusedAt("shop")]),
    );
    expect(transport.mock.calls.length).toBe(sent);
    expect(trace).toContain(
      "Not sent · my_orders · the user's request wasn't asked of this Company",
    );
    // Asked of the shop, the same tools reach it.
    const asked = await connect(r, [], [], askedHere(origin, "shop"));
    transport.mockClear();
    expect(await asked.my_orders!.execute({})).toEqual({ ok: true });
    expect(transport.mock.calls[0]![0]).toBe(`${origin}/orders`);
  } finally {
    vi.unstubAllEnvs();
  }
});

it("reports only to the Company the request was asked of, never about connecting Companies or naming another (§9.3)", async () => {
  vi.stubEnv("PAP_ACCOUNT_ORIGINS", "https://shop.papsandbox.com");
  try {
    const { r, origin } = shopWithEverything();
    const feedback = `${origin}/poppy/feedback`;
    const sends = () =>
      transport.mock.calls.filter(([url]) => url === feedback).length;
    const report = {
      task: "Pay with a gift card",
      description: "The User wanted to pay with a gift card.",
    };
    // Asked of another Company: refused before anything is sent.
    const elsewhere = await connect(r, [], [], askedOfLantern(origin, "shop"));
    expect(
      await elsewhere.report_unsupported_task!.execute(report),
    ).toMatchObject({ sent: false, not_addressed: true });
    // A turn about the conversation's Companies reports nothing either.
    const about = await connect(r, [], [], {
      ...askedHere(origin, "shop"),
      aboutCompanies: () => true,
    });
    expect(await about.report_unsupported_task!.execute(report)).toEqual({
      sent: false,
      reason:
        "This turn is about which companies the conversation is connected to. That is no task shop can't do, so nothing was reported to shop.",
    });
    // Nor does a report that names another Company.
    const here = await connect(r, [], [], askedHere(origin, "shop"));
    expect(
      await here.report_unsupported_task!.execute({
        task: "Connect with Lantern Noodle Bar",
        description: "The User asked to connect Lantern Noodle Bar.",
      }),
    ).toEqual({
      sent: false,
      reason:
        "The report names Lantern Noodle Bar. A report to shop describes a task asked of shop, and names no other company.",
    });
    expect(sends()).toBe(0);
    // The shop's own task, asked of it, is reported.
    expect(await here.report_unsupported_task!.execute(report)).toEqual({
      sent: true,
    });
    expect(sends()).toBe(1);
    // Without a turn's request, no report tool is offered at all.
    expect(await connect(r, [])).not.toHaveProperty("report_unsupported_task");
  } finally {
    vi.unstubAllEnvs();
  }
});
