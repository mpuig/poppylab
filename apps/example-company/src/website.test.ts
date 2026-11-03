import { it, expect, vi } from "vitest";
import { testApp } from "./test-app.js";
import { website } from "./website.js";
import { approvalOf } from "./test-v2.js";
import { operations } from "./operations.js";
import { scryptSync } from "node:crypto";
import { Script } from "node:vm";
const origin = "http://juniper.localhost:4100";
async function setup() {
  const app = testApp();
  const commerce = operations(app, () => ({
    client: "agent",
    user: "user",
    account: "alex",
    expires: Date.now() + 60000,
  }));
  website(app, origin, commerce.view);
  return app;
}
async function login(
  app: Awaited<ReturnType<typeof setup>>,
  password?: string,
) {
  const page = await app.inject("/site/login");
  const cookie = String(page.headers["set-cookie"]).split(";")[0]!;
  return app.inject({
    method: "POST",
    url: "/site/login",
    headers: { origin, cookie },
    payload: password ? { password } : {},
  });
}
it("switches browser personas without retaining the old session and rejects unknown accounts", async () => {
  const app = await setup();
  try {
    const first = await login(app);
    const old = (first.headers["set-cookie"] as string[])
      .find((v) => v.startsWith("juniper_web="))!
      .split(";")[0]!;
    const page = await app.inject("/site/login");
    const challenge = String(page.headers["set-cookie"]).split(";")[0]!;
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/site/login",
          headers: { origin, cookie: challenge },
          payload: { account: "unknown" },
        })
      ).statusCode,
    ).toBe(400);
    const next = await app.inject({
      method: "POST",
      url: "/site/login",
      headers: { origin, cookie: challenge + "; " + old },
      payload: { account: "maya" },
    });
    const current = (next.headers["set-cookie"] as string[])
      .find((v) => v.startsWith("juniper_web="))!
      .split(";")[0]!;
    expect(
      (await app.inject({ url: "/site/state", headers: { cookie: old } }))
        .statusCode,
    ).toBe(401);
    const data = (
      await app.inject({ url: "/site/state", headers: { cookie: current } })
    ).json();
    expect(data.account_id).toBe("maya");
    expect(data.profile.name).toBe("Maya Sol");
    expect(
      (await app.inject({ url: "/account", headers: { cookie: current } }))
        .body,
    ).toContain('data-account="maya"');
  } finally {
    await app.close();
  }
});
it("requires customer sign-in; login is browser bound and rejects cross-origin submission", async () => {
  const app = await setup();
  try {
    expect((await app.inject("/site/state")).statusCode).toBe(401);
    expect((await app.inject("/account")).headers.location).toBe("/site/login");
    const page = await app.inject("/site/login");
    const cookie = String(page.headers["set-cookie"]).split(";")[0]!;
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/site/login",
          headers: { cookie, origin: "https://evil.example" },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/site/login",
          headers: { origin },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
  } finally {
    await app.close();
  }
});
it("shows the same basket and delivery state before and after agent approval; never applies a proposal itself", async () => {
  const app = await setup();
  try {
    const entered = await login(app);
    expect(entered.statusCode).toBe(302);
    const cookies = entered.headers["set-cookie"] as string[];
    const cookie = cookies
      .find((c) => c.startsWith("juniper_web="))!
      .split(";")[0]!;
    const get = () => app.inject({ url: "/site/state", headers: { cookie } });
    const before = (await get()).json();
    expect(before.delivery.items[0].id).toBe("oranges");
    const proposed = (
      await app.inject({
        method: "POST",
        url: "/api/account/delivery-items-change",
        payload: { product_id: "oranges", quantity: 0 },
      })
    ).json().operation;
    expect((await get()).json().delivery.items).toEqual(before.delivery.items);
    expect((await get()).json().activity[0].state).toBe("proposed");
    const approved = await app.inject({
      method: "POST",
      url: "/api/account/delivery-items-change",
      payload: { product_id: "oranges", quantity: 0 },
      headers: approvalOf(proposed),
    });
    expect(approved.statusCode).toBe(200);
    const after = await get();
    expect(
      after.json().delivery.items.map((i: { id: string }) => i.id),
    ).toEqual(["coffee"]);
    expect(after.json().basket).toEqual(before.basket);
    expect(after.headers["cache-control"]).toBe("no-store");
    expect(after.body).not.toMatch(
      /access_token|refresh_token|client_assertion|privateKey/,
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/site/logout",
          headers: { cookie, origin: "https://evil.example" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/site/logout",
          headers: { cookie, origin },
        })
      ).statusCode,
    ).toBe(200);
    expect((await get()).statusCode).toBe(401);
  } finally {
    await app.close();
  }
});
it("uses the configured password for website login too", async () => {
  const salt = "01".repeat(16);
  vi.stubEnv(
    "JUNIPER_PASSWORD_HASH",
    salt +
      ":" +
      scryptSync("dedicated-test-password", salt, 64).toString("hex"),
  );
  const app = await setup();
  try {
    expect((await login(app, "wrong")).statusCode).toBe(401);
    expect((await login(app, "dedicated-test-password")).statusCode).toBe(302);
  } finally {
    vi.unstubAllEnvs();
    await app.close();
  }
});
it("serves parseable customer code without HTML injection sinks", async () => {
  const app = await setup();
  try {
    const script = (await app.inject("/site/app.js")).body;
    expect(() => new Script(script)).not.toThrow();
    expect(script).not.toContain("innerHTML");
    expect((await app.inject("/help")).body).toContain(
      "Nothing is charged or shipped",
    );
  } finally {
    await app.close();
  }
});
it("expires website sessions", async () => {
  const app = await setup();
  let clock: ReturnType<typeof vi.spyOn> | undefined;
  try {
    const entered = await login(app);
    const cookie = (entered.headers["set-cookie"] as string[])
      .find((c) => c.startsWith("juniper_web="))!
      .split(";")[0]!;
    clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1800001);
    expect(
      (await app.inject({ url: "/site/state", headers: { cookie } }))
        .statusCode,
    ).toBe(401);
  } finally {
    clock?.mockRestore();
    await app.close();
  }
});

it("serves the generated client script, in sync with src/site/app.js and in English", async () => {
  const { testApp } = await import("./test-app.js");
  const { website } = await import("./website.js");
  const { readFileSync } = await import("node:fs");
  const { render, source, target } = await import("../scripts/site-script.mjs");
  // A forgotten `pnpm site:script` fails here rather than in the browser.
  expect(readFileSync(target, "utf8")).toBe(
    render(readFileSync(source, "utf8")),
  );
  const app = testApp();
  website(app, "http://juniper.localhost:4100", () => ({}));
  const script = (await app.inject("/site/app.js")).body;
  expect(script.startsWith('"use strict";')).toBe(true);
  expect(() => new Function(script)).not.toThrow();
  expect(script).not.toMatch(/[áéíóúñ¿¡]/);
});
