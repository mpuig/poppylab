import { expect, it } from "vitest";
import type { ApiTool } from "@poppy-lab/pap-client";
import { demoReply } from "./chat-demo";
import type { HeldTurn } from "./chat-turn";
import type { Connection } from "./runtime";

it("says where the Company's invitation to talk is answered", async () => {
  const sent: unknown[] = [];
  const tools = {
    company_agent_send: {
      execute: async (args: { data: { request: string } }) => {
        sent.push(args.data);
        return args.data.request === "order_status"
          ? { replies: [{ data: { last_delivery: { id: "ord_LNB0907" } } }] }
          : {
              replies: [
                { text: "Refunding all of order ord_LNB0907 needs a word." },
              ],
            };
      },
    },
  } as unknown as Record<string, ApiTool>;
  const connection = {
    url: "https://food-demo.poppylab.dev",
    company: { document: { organization: { name: "Lantern Noodle Bar" } } },
  } as unknown as Connection;
  const turn = {
    asked: "My last order never arrived.",
    conversation: { history: [], connections: [connection] },
  } as unknown as HeldTurn;
  const { text } = await demoReply(turn, connection, tools);
  expect(sent).toEqual([
    { request: "order_status" },
    { request: "order_not_delivered", order_id: "ord_LNB0907" },
  ]);
  // The invitation is a question in the conversation, where it arrived,
  // with its own buttons: no panel sits above the message box any more.
  expect(text).not.toMatch(/above the message box/);
  expect(text).toMatch(
    /If the Company asks to talk with you, Iris asks you in the conversation: answer with the buttons under the question, or in words\.$/,
  );
});
