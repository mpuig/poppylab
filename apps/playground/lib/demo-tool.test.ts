import { expect, it } from "vitest";
import { pickDemoTool } from "./demo-tool";
const tool = (description: string, required?: string[]) => ({
  description,
  schema: { type: "object", properties: {}, ...(required ? { required } : {}) },
});
it("picks a matching tool that needs no arguments", () => {
  const tools = {
    getRewards: tool("Loyalty rewards"),
    getInventory: tool("Products in stock"),
    getOrder: tool("One order", ["order_id"]),
  };
  expect(pickDemoTool("what products do you have", tools)).toBe("getInventory");
  expect(pickDemoTool("show my order", tools)).not.toBe("getOrder");
  expect(
    pickDemoTool("hello", { getOrder: tool("x", ["id"]) }),
  ).toBeUndefined();
});
