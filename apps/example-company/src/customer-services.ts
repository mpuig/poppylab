import type { Reply, Req, Router } from "./router.js";
import { randomId } from "@poppy-lab/pap-client";
import type { Session } from "@poppy-lab/pap-company";
import { profiles, profileState, type ProfileCustomer } from "./profiles.js";
export const faqs = [
  {
    topic: "delivery",
    question: "Which days can I get my shopping?",
    answer:
      "In this demo, deliveries run on Tuesdays, Thursdays and Saturdays. Your recurring delivery and each order have their own date.",
  },
  {
    topic: "billing",
    question: "Is anything actually charged?",
    answer:
      "No. Orders, invoices and amounts are fictional. Don't enter real bank details.",
  },
  {
    topic: "delivery",
    question: "How much is delivery?",
    answer:
      "Simulated delivery costs USD 5; it's free from USD 35 of products. Always check the total in the proposal.",
  },
  {
    topic: "profile",
    question: "Who can see my data?",
    answer:
      "The website uses its own session. Your agent needs your permission to read the account. Logging out of the website doesn't revoke the agent's access.",
  },
  {
    topic: "other",
    question: "How is a support case resolved?",
    answer:
      "Send a request with fictional details. You get an automatic test reply. The agent can propose closing it; you decide whether to approve.",
  },
];
export type SupportCase = {
  id: string;
  subject: string;
  topic: string;
  order_id?: string;
  status: "open" | "resolved";
  version: number;
  created_at: string;
  messages: Array<{
    actor: "customer" | "simulated_support";
    text: string;
    at: string;
  }>;
};
export type ServiceCustomer = ProfileCustomer & {
  cases?: SupportCase[];
  profile?: { name: string; email: string; address: string };
  orders: Array<{
    id: string;
    total_cents: number;
    currency: string;
    status: string;
  }>;
};
/** Operations v2 gate: refuses with the operation, or performs an approved one. */
export type Propose = (
  req: Req,
  reply: Reply,
  s: Session,
  terms: Record<string, unknown>,
  summary: string,
) => Reply | Response;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function input(value: unknown) {
  if (
    !object(value) ||
    Object.keys(value).some(
      (k) => !["subject", "topic", "message", "order_id"].includes(k),
    ) ||
    typeof value.subject !== "string" ||
    !value.subject.trim() ||
    value.subject.length > 120 ||
    typeof value.message !== "string" ||
    !value.message.trim() ||
    value.message.length > 2000 ||
    !["delivery", "billing", "profile", "other"].includes(
      String(value.topic),
    ) ||
    (value.order_id !== undefined &&
      (typeof value.order_id !== "string" || value.order_id.length > 100))
  )
    throw Error("invalid_case");
  return {
    subject: value.subject.trim(),
    topic: String(value.topic),
    message: value.message.trim(),
    ...(value.order_id ? { order_id: String(value.order_id) } : {}),
  };
}
export function customerServices(
  app: Router,
  sessionFor: (r: Req) => Session,
  customer: (s: Session) => ServiceCustomer,
  propose: Propose,
) {
  const prepare = (c: ServiceCustomer) => {
    c.cases ??= [];
    profileState(c);
    return c;
  };
  const profileService = profiles(app, sessionFor, customer, propose);
  const validate = (c: ServiceCustomer, data: unknown) => {
    const v = input(data);
    prepare(c);
    if (c.cases!.length >= 100) throw Error("case_limit");
    if (v.order_id && !c.orders.some((o) => o.id === v.order_id))
      throw Error("order_not_found");
    return v;
  };
  const create = (s: Session, data: unknown, id = `case_${randomId()}`) => {
    const c = prepare(customer(s)),
      v = validate(c, data);
    if (c.cases!.some((x) => x.id === id)) throw Error("duplicate_case");
    const at = new Date().toISOString();
    const answer = faqs.find((f) => f.topic === v.topic)!.answer;
    const record: SupportCase = {
      id,
      subject: v.subject,
      topic: v.topic,
      ...(v.order_id ? { order_id: v.order_id } : {}),
      status: "open",
      version: 1,
      created_at: at,
      messages: [
        { actor: "customer", text: v.message, at },
        {
          actor: "simulated_support",
          text: `Automatic test reply: ${answer} No order or amount has changed.`,
          at,
        },
      ],
    };
    c.cases!.push(record);
    return record;
  };
  const find = (s: Session, id: string) =>
    prepare(customer(s)).cases!.find((c) => c.id === id);
  app.get("/api/faq", async () => ({ faqs }));
  app.get("/api/account/profile", async (req) => ({
    ...profileState(customer(sessionFor(req))),
    fictional: true,
  }));
  app.get("/api/account/invoices", async (req) => ({
    invoices: view(sessionFor(req)).invoices,
    fictional: true,
  }));
  app.get("/api/account/cases", async (req) => ({
    cases: prepare(customer(sessionFor(req)))
      .cases!.slice(-20)
      .reverse()
      .map(({ messages, ...c }) => ({ ...c, message_count: messages.length })),
  }));
  app.get<{ Params: { id: string } }>(
    "/api/account/cases/:id",
    async (req, reply) =>
      find(sessionFor(req), req.params.id) ??
      reply.code(404).send({ error: "case_not_found" }),
  );
  app.post("/api/account/case-proposal", async (req, reply) => {
    try {
      const s = sessionFor(req),
        v = validate(customer(s), req.body);
      const terms = {
        kind: "support_case",
        case_id: `case_${randomId()}`,
        ...v,
      };
      return propose(
        req,
        reply,
        s,
        terms,
        `Open a fictional ${v.topic} support case: “${v.subject}”. Message: “${v.message}”. ${v.order_id ? `Order ${v.order_id}.` : ""} It only creates a request and an automatic test reply; no order, delivery or amount changes.`,
      );
    } catch {
      return reply.code(400).send({ error: "invalid_case_or_order" });
    }
  });
  app.post("/api/account/case-resolution", async (req, reply) => {
    const b = req.body;
    if (
      !object(b) ||
      Object.keys(b).some((k) => k !== "case_id") ||
      typeof b.case_id !== "string"
    )
      return reply.code(400).send({ error: "invalid_case" });
    const s = sessionFor(req),
      c = find(s, b.case_id);
    if (!c) return reply.code(404).send({ error: "case_not_found" });
    if (c.status !== "open")
      return reply.code(409).send({ error: "case_not_open" });
    return propose(
      req,
      reply,
      s,
      {
        kind: "support_resolution",
        case_id: c.id,
        case_version: c.version,
        from_status: "open",
        to_status: "resolved",
        subject: c.subject,
        resolution:
          "Close as answered by the automatic test support. No refund and no change to the purchase.",
      },
      `Close the case “${c.subject}” (${c.id}), version ${c.version}, as answered. No money is refunded and no order or delivery changes. Needs your approval.`,
    );
  });
  function view(s: Session) {
    const c = prepare(customer(s));
    return {
      ...profileState(c),
      cases: c.cases!.slice(-20).reverse(),
      invoices: c.orders.map((o) => ({
        id: `inv_${o.id}`,
        order_id: o.id,
        total_cents: o.total_cents,
        currency: o.currency,
        status: "simulated",
        note: "Fictional document; it does not prove any real payment.",
      })),
    };
  }
  return {
    view,
    create,
    updateProfile: profileService.updateProfile,
    reply(s: Session, id: string, message: unknown) {
      const c = find(s, id);
      if (
        !c ||
        typeof message !== "string" ||
        !message.trim() ||
        message.length > 2000 ||
        c.messages.length + 2 > 20
      )
        throw Error("invalid_message");
      const at = new Date().toISOString();
      c.messages.push(
        { actor: "customer", text: message.trim(), at },
        {
          actor: "simulated_support",
          text: "Automatic test reply: we have recorded your follow-up. The case stays open. No order or amount has changed.",
          at,
        },
      );
      c.status = "open";
      c.version++;
      return c;
    },
    stale(s: Session, t: Record<string, unknown>) {
      const c = prepare(customer(s));
      if (t.kind === "profile_change") return profileService.stale(s, t);
      return t.kind === "support_case"
        ? c.cases!.length >= 100 ||
            !!c.cases!.find((x) => x.id === t.case_id) ||
            (typeof t.order_id === "string" &&
              !c.orders.some((o) => o.id === t.order_id))
        : !c.cases!.some(
            (x) =>
              x.id === t.case_id &&
              x.version === t.case_version &&
              x.status === "open",
          );
    },
    apply(s: Session, t: Record<string, unknown>) {
      if (t.kind === "profile_change") return profileService.apply(s, t);
      if (t.kind === "support_case") {
        const c = create(
          s,
          {
            subject: t.subject,
            topic: t.topic,
            message: t.message,
            ...(t.order_id ? { order_id: t.order_id } : {}),
          },
          String(t.case_id),
        );
        return {
          summary: `Case ${c.id} opened. An automatic test reply is available. No order or amount has changed.`,
          data: structuredClone(c),
        };
      }
      const c = find(s, String(t.case_id))!;
      c.status = "resolved";
      c.version++;
      return {
        summary: `Case ${c.id} closed as answered. No refund and no change to the purchase.`,
        data: structuredClone(c),
      };
    },
  };
}
