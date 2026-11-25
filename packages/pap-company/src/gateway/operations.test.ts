/**
 * The Operations v3 gate on a tenant its customers share: what one account
 * holds is bounded, so it leaves the others room.
 */
import { expect, it } from "vitest";
import { newSessionId } from "@poppy-lab/pap-client/core";
import { setup } from "./test-company.ts";

it("leaves another customer room when one account loops a change with fresh keys", async () => {
  const x = await setup(
    {},
    {
      persona: (id) => (id === "elena" || id === "robin" ? { id } : undefined),
      mount: (app, ctx) => {
        app.post("/api/account/things", (c) =>
          ctx.gate(c, {
            key: `thing:${c.req.query("key")}`,
            terms: {},
            summary: "Add a thing",
            perform: () => ({ summary: "Added" }),
          }),
        );
      },
    },
  );
  const scope = "things:read things:write";
  const elena = await x.signIn(scope);
  const robin = await x.signIn(scope, { account: "robin" });
  if ("refused" in elena || "refused" in robin) throw new Error("refused");
  const change = (access: string, key: string, session?: string) =>
    x.call(`/api/account/things?key=${key}`, {
      method: "POST",
      access,
      extensions: '"operations";v="3"',
      ...(session ? { session } : {}),
    });
  // As many fresh keys as the tenant holds operations, or until refused.
  let refused: Response | undefined;
  for (let n = 0; n < 2000 && !refused; n++) {
    const answer = await change(elena.access_token, `fresh-${n}`);
    if (answer.status !== 403) refused = answer;
  }
  const other = await change(robin.access_token, "one", newSessionId());
  expect(other.status).toBe(403);
  expect(await other.json()).toMatchObject({ error: "approval_required" });
  // The account over its share is told what a full tenant is told (§5.6).
  expect(refused?.status).toBe(429);
  expect(await refused!.json()).toEqual({ error: "too_many_operations" });
  expect(refused!.headers.get("retry-after")).toBe("60");
});
