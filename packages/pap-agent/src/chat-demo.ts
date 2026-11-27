import {
  InvalidToolArguments,
  randomId,
  type ApiTool,
} from "@poppy-lab/pap-client";
import { companyProfile } from "@poppy-lab/pap-core";
import { agentName } from "./agent";
import type { HeldTurn } from "./chat-turn";
import {
  demoAside,
  demoChange,
  demoChangeKind,
  demoChangeReply,
} from "./demo-changes";
import { demoEspiAnswer, demoEspiRead, demoEspiReply } from "./demo-espi";
import { demoFdxAnswer, demoFdxRead, demoFdxReply } from "./demo-fdx";
import {
  agentAnswer,
  feedbackAnswer,
  notSentReply,
  readable,
} from "./demo-text";
import { pickDemoTool } from "./demo-tool";
import type { Connection } from "./runtime";
import { shoppingTarget } from "./shopping-context";

/**
 * A demo-mode turn with one Company. Demo mode has no model to put an
 * answer into words: it shows the Company's answer as plain lines, and
 * `raw` is the exact JSON it keeps for "Data".
 */
export async function demoReply(
  turn: HeldTurn,
  connection: Connection,
  tools: Record<string, ApiTool>,
): Promise<{ text: string; raw: unknown }> {
  const { asked, conversation: run } = turn;
  let raw: unknown;
  const show = (value: unknown) => {
    raw = value;
    return readable(value);
  };
  const companyName = connection.company!.document.organization.name;
  // What the Company's agent said is shown above as Company content; the
  // demo's lines point to it, and "Data" keeps the exact answer.
  const fromAgent = (value: unknown) => {
    raw = value;
    return agentAnswer(value, companyName);
  };
  const lowered = asked.toLowerCase();
  const change = demoChangeKind(asked, tools);
  const aside = demoAside(asked, tools);
  // Use FDX on: balances and transactions through the FDX-shaped tools.
  const fdxRead = demoFdxRead(asked, tools);
  // Use ESPI on: usage and bills through the ESPI-shaped tools.
  const espiRead = demoEspiRead(asked, tools);
  let text: string;
  if (
    tools.company_agent_send &&
    /never (arrived|came)|didn'?t arrive|nothing (arrived|came)|not delivered/.test(
      lowered,
    )
  ) {
    // The demo's way into a Direct Conversation (§8.10): report an order
    // that never arrived; the Company may ask to talk with the user.
    const status = (await tools.company_agent_send.execute({
      data: { request: "order_status" },
    })) as {
      replies?: Array<{ data?: { last_delivery?: { id?: unknown } } }>;
    };
    const order = status.replies
      ?.map((r) => r.data?.last_delivery?.id)
      .find((id): id is string => typeof id === "string");
    const result = order
      ? await tools.company_agent_send.execute({
          data: { request: "order_not_delivered", order_id: order },
        })
      : status;
    text = `Protocol demo (no LLM). ${order ? `Told the Company's agent that order ${order} never arrived.` : "Asked the Company's agent for your orders first."} ${fromAgent(result)}\n\nIf the Company asks to talk with you, accept or decline with the buttons above the message box.`;
  } else if (change || aside) {
    // A change the demo can prepare comes first, whatever else the message
    // says: "for the quarterly report" in a payment is its memo, not
    // feedback. Short of one, words for the Company's agent or for
    // feedback decide; only then does the demo ask for what is missing.
    const plan =
      change && connection.accountToken
        ? await demoChange(asked, tools, randomId)
        : undefined;
    if (plan && "call" in plan) {
      // Another kind of Company (orders, a bank, flights): the demo read
      // the account and asks for one change with exact arguments. The
      // Company answers approval_required and holds it for the User.
      try {
        const result = await tools[plan.call]!.execute(plan.args);
        text = `Protocol demo (no LLM). ${demoChangeReply(plan, result, show)}`;
      } catch (error) {
        // The demo chose the arguments; when the Company's description
        // of the tool rejects them, the request wasn't sent. Say that, not
        // "check the Company is running".
        if (!(error instanceof InvalidToolArguments)) throw error;
        text = `Protocol demo (no LLM). The demo prepared a request for ${plan.call} that this Company's description of the tool doesn't accept, so the demo didn't send it. Ask for it in other words or with other values, or select a model.`;
      }
    } else if (aside === "agent") {
      // The demo's way into a conversation (§8): ask what the Company's
      // agent handles, or ask for a person (which needs a conversation first).
      const person = /talk to|someone/.test(lowered);
      const results: unknown[] = [];
      if (!person || !connection.conversation?.id)
        results.push(
          await tools.company_agent_send!.execute({
            data: { request: "help" },
          }),
        );
      if (person) results.push(await tools.company_agent_handoff!.execute({}));
      text = `Protocol demo (no LLM). Live Company Agent ${person ? "handoff" : "reply"}. ${fromAgent(results.at(-1))}\n\nThe Company's agent answers structured requests. For a real conversation with it, select a model.`;
    } else if (aside === "feedback") {
      // The demo's way into feedback (§9.3): a fixed, identifier-free report.
      const result = await tools.report_unsupported_task!.execute({
        task: "Pay with a gift card",
        description:
          "The User wanted to pay with a gift card they were given. None of the Company's APIs or its agent's requests apply a gift card.",
      });
      // Iris doesn't send a report twice in a Session, or one for a task
      // the Company already lists: the heading says which happened.
      const sent = (result as { sent?: unknown } | null)?.sent !== false;
      // An alternative the Company gave is shown above as its own entry.
      raw = result;
      text = `Protocol demo (no LLM). Feedback report ${sent ? "sent" : "not sent"} to the Company (§9.3):\n\n${feedbackAnswer(result, companyName)}\n\nWith a model, ${agentName()} reports a task only after trying the Company's tools.`;
    } else if (!connection.accountToken) {
      text =
        "Protocol demo (no LLM). Sign in first: the demo reads your account to prepare this change, and nothing changes until you approve it.";
    } else {
      text = `Protocol demo (no LLM). ${plan?.say ?? "The demo can't prepare that change here."}`;
    }
  } else if (fdxRead) {
    text = demoFdxReply(await demoFdxAnswer(fdxRead, tools), show);
  } else if (espiRead) {
    text = demoEspiReply(await demoEspiAnswer(espiRead, tools), show);
  } else {
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
                : /my.*deliver|deliver.*my/.test(message) && tools.my_deliveries
                  ? "my_deliveries"
                  : /deliver|ship|saturday|tuesday|thursday/.test(message)
                    ? "delivery_info"
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
      const allowed = selectedTool.schema.properties as Record<string, unknown>;
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
      // Signed out, or without the permission, Iris stops before asking:
      // there is no answer of the Company's to show, only what to press.
      const hints = companyProfile(connection.company!).scopeHints;
      const unsent = notSentReply(
        result,
        companyName,
        (scope) => hints[scope]?.changes !== "none",
      );
      text = unsent
        ? `Protocol demo (no LLM). ${unsent}`
        : `Protocol demo (no LLM). The company answered:\n\n${show(result)}\n\n${tools.my_basket ? "Try “my basket”, “set apples in my basket to 2”, “checkout on Saturday”, “my orders”, or “my deliveries”. Basket edits and checkout are proposals only until you click Approve. Demo quantities are absolute totals, not increments." : `The demo called ${fallback}, a tool that needs no arguments.`} For natural-language reasoning, select a model.`;
    }
  }
  return { text, raw };
}
