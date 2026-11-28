/**
 * One long conversation in the playground, in Spanish, as a person has it:
 *
 * 1. Fernwick: a question connects it; sign in as Elena, read only, then
 *    give change permission from the guide's suggestion; ask for the plan
 *    switch; approve it by typing "sí".
 * 2. Lantern: a question connects it; ask it something; sign in read
 *    only; ask for an order change that needs change permission; give it
 *    from Iris's question; go on with "sí"; approve on the card, from the
 *    keyboard.
 * 3. Reload the page.
 *
 * After each step, and after the reload, it checks what earlier bugs got
 * wrong: every block (proposal cards, sign-in and change-permission asks,
 * Iris's questions) in time order where it arose, nothing docked below the
 * newest message, decided cards folded in place, no turn lost after a
 * sign-in or a change permission, the "N waiting" count, the Company
 * "Talk to … yourself" names, and the focus back in the message box.
 *
 * The model is scripted (`fake-model.ts`); the Companies and the
 * playground are the real ones (`servers.ts`).
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const FERNWICK = "Fernwick Power & Light";
const LANTERN = "Lantern Noodle Bar";

/**
 * The transcript as a list of what it shows, in order: `you: <words>`,
 * `iris` (or `iris?` for one of Iris's questions), `company`, `error`;
 * `card <Company> open|folded`; `ask <kind> <Company> open|waiting|done`.
 */
function rows(page: Page) {
  return page.locator(".messages > *").evaluateAll((elements) =>
    elements.map((e) => {
      const company = (id: string) =>
        id.includes("fernwick")
          ? "Fernwick"
          : id.includes("noodles")
            ? "Lantern"
            : id;
      if (e.matches("article.message")) {
        const text =
          e.querySelector(".message-text")?.textContent?.trim() ?? "";
        if (e.classList.contains("you")) return `you: ${text}`;
        if (e.classList.contains("agent") || e.classList.contains("own"))
          return /¿|\?$/.test(text) ? "iris?" : "iris";
        return [...e.classList].filter((c) => c !== "message").join(" ");
      }
      if (e.matches("details.operation-review"))
        return `card ${company(e.id)} ${(e as HTMLDetailsElement).open ? "open" : "folded"}`;
      if (e.matches(".ask-block")) {
        const kind = e.id.replace(/^ask-ask-/, "").split("-")[0];
        const phase = e.classList.contains("done")
          ? "done"
          : e.classList.contains("waiting")
            ? "waiting"
            : "open";
        return `ask ${kind} ${company(e.id)} ${phase}`;
      }
      return `other ${e.className}`;
    }),
  );
}
const same = (a: string[], b: string[]) =>
  a.length === b.length && a.every((row, i) => row === b[i]);
type View = (list: string[]) => string[];
const whole: View = (list) => list;

/**
 * Waits until the transcript shows exactly `expected`, in that order,
 * both seen through `view`: nothing missing, nothing more, and nothing
 * after the newest message that didn't arise there.
 */
async function expectRows(page: Page, expected: string[], view = whole) {
  await expect
    .poll(
      async () => {
        const actual = view(await rows(page));
        return same(actual, view(expected)) ? "as expected" : actual;
      },
      { message: `The transcript should be: ${view(expected).join(" | ")}` },
    )
    .toBe("as expected");
}

/** What the heading counts as waiting for the person: 0 when it shows none. */
async function expectWaiting(page: Page, count: number) {
  const toggle = page.locator(".pending-toggle");
  if (count === 0) await expect(toggle).toHaveCount(0);
  else await expect(toggle).toHaveText(`${count} waiting`);
}

/** "Talk to … yourself" names the Company the conversation is with now. */
async function expectTalkTo(page: Page, company: string) {
  await expect(
    page.locator(".direct-bar button", { hasText: /^Talk to / }),
  ).toHaveText(`Talk to ${company} yourself`);
}

const messageBox = (page: Page) => page.locator("#task");

/**
 * Sends `words` from the message box with Enter, waits for the turn to be
 * over, and checks the box has the focus back.
 */
async function send(page: Page, words: string) {
  const mine = page.locator(".messages > article.message.you");
  const before = await mine.count();
  await messageBox(page).fill(words);
  await messageBox(page).press("Enter");
  await expect(mine).toHaveCount(before + 1);
  await expect(
    page.locator(".messages > article.message").last(),
  ).not.toHaveClass(/\byou\b/);
  await expect(page.locator(".thinking")).toHaveCount(0);
  await expect(messageBox(page)).toBeEnabled();
  await expect(messageBox(page)).toBeFocused();
}

/**
 * Signs in as Elena on the Company's own consent page, which `press`
 * opens in a tab of its own, and checks the tab lands on the playground's
 * "Signed in" page. `access` is what the sheet should ask for; `whileOpen`
 * runs while the sheet is still open.
 */
async function consent(
  context: BrowserContext,
  press: () => Promise<void>,
  access: "read" | "change",
  whileOpen?: () => Promise<void>,
) {
  const opened = context.waitForEvent("page");
  await press();
  const tab = await opened;
  await tab.locator("#account-elena").check();
  const changes = tab
    .locator(".sheet-group")
    .filter({ hasText: "Propose changes" });
  await expect(changes.locator(".sheet-none")).toHaveCount(
    access === "read" ? 1 : 0,
  );
  await whileOpen?.();
  await tab.getByRole("button", { name: "Allow", exact: true }).click();
  await tab.waitForURL(/\/playground\/sign-in\/done/);
  await expect(tab.getByText("Signed in.")).toBeVisible();
  await tab.close();
}

const askButton = (page: Page, kind: string, host: string) =>
  page.locator(`.ask-block[id^="ask-ask-${kind}-${host}"]:not(.done) button`);
const card = (page: Page, host: string) =>
  page.locator(`details.operation-review[id^="proposal-${host}"]`);

test("one long conversation keeps everything where it arose", async ({
  page,
  context,
}) => {
  await page.goto("/playground");
  // The server's model key makes the scripted model the page's choice.
  await expect(page.getByText("OpenAI compatible").first()).toBeVisible();

  // 1. Fernwick ---------------------------------------------------------
  const fernwick: string[] = [];
  await send(page, "¿Qué tarifas tiene Fernwick?");
  // Iris connects it and says so, its agent answers, then Iris does; the
  // guide's sign-in follows.
  fernwick.push("you: ¿Qué tarifas tiene Fernwick?", "iris", "company", "iris");
  await expectRows(page, [...fernwick, "ask signin Fernwick open"]);
  await expectWaiting(page, 0);
  await expectTalkTo(page, FERNWICK);

  await consent(
    context,
    () => askButton(page, "signin", "fernwick").click(),
    "read",
    async () => {
      // The sign-in waits in its tab, where it arose, and is counted.
      await expectRows(page, [...fernwick, "ask signin Fernwick waiting"]);
      await expectWaiting(page, 1);
    },
  );
  await expectRows(page, [
    ...fernwick,
    "ask signin Fernwick done",
    "ask write Fernwick open",
  ]);
  await expectWaiting(page, 0);

  await consent(
    context,
    () => askButton(page, "write", "fernwick").click(),
    "change",
  );
  fernwick.push("ask signin Fernwick done", "ask write Fernwick done");
  await expectRows(page, fernwick);
  await expectWaiting(page, 0);

  await send(page, "Cambia el cargador del coche a la tarifa plana.");
  // The proposal's card follows Iris's question about it.
  fernwick.push(
    "you: Cambia el cargador del coche a la tarifa plana.",
    "iris",
    "iris?",
  );
  await expectRows(page, [...fernwick, "card Fernwick open"]);
  await expect(
    card(page, "fernwick").locator(".operation-state"),
  ).toContainText("Waiting for you");
  await expectWaiting(page, 1);

  await send(page, "sí");
  // Approved in words: the card folds where it was, above the answer.
  fernwick.push("card Fernwick folded", "you: sí", "iris");
  await expectRows(page, fernwick);
  await expect(
    card(page, "fernwick").locator(".operation-state"),
  ).toContainText("Approved by you");
  await expectWaiting(page, 0);
  await expectTalkTo(page, FERNWICK);

  // 2. Lantern ----------------------------------------------------------
  const lantern: string[] = [];
  await send(page, "¿Qué hay en el menú de Lantern?");
  // With Fernwick connected, the model connects Lantern with Iris's tool.
  lantern.push("you: ¿Qué hay en el menú de Lantern?", "iris");
  await expectRows(page, [...fernwick, ...lantern]);
  await expectWaiting(page, 0);

  await send(page, "Enséñame el menú de Lantern.");
  lantern.push("you: Enséñame el menú de Lantern.", "company", "iris");
  await expectRows(page, [...fernwick, ...lantern, "ask signin Lantern open"]);
  await expectWaiting(page, 0);
  await expectTalkTo(page, LANTERN);

  await consent(
    context,
    () => askButton(page, "signin", "noodles").click(),
    "read",
  );
  lantern.push("ask signin Lantern done");
  await expectRows(page, [...fernwick, ...lantern, "ask write Lantern open"]);
  await expectWaiting(page, 0);
  await expectTalkTo(page, LANTERN);

  await send(page, "Añade un helado de matcha a mi pedido de Lantern.");
  // Read only: Iris asks whether to ask for change permission, with the
  // button, so the guide's own suggestion goes.
  lantern.push(
    "you: Añade un helado de matcha a mi pedido de Lantern.",
    "iris",
    "iris?",
  );
  await expectRows(page, [...fernwick, ...lantern]);
  await expectWaiting(page, 1);

  await consent(
    context,
    () =>
      page
        .locator(".messages > article.message")
        .last()
        .locator(".message-choices button")
        .click(),
    "change",
  );
  // The turn that asked is still there, and Iris asks once whether to go
  // on with it.
  lantern.push(
    "you: Pedir permiso de cambios en Lantern Noodle Bar",
    "ask write Lantern done",
    "iris",
    "iris?",
  );
  await expectRows(page, [...fernwick, ...lantern]);
  await expectWaiting(page, 1);

  await send(page, "sí");
  lantern.push("you: sí", "iris", "iris?");
  await expectRows(page, [...fernwick, ...lantern, "card Lantern open"]);
  await expectWaiting(page, 1);

  // Approved on the card, from the keyboard: the message box has the
  // focus back once the decision is in.
  await card(page, "noodles")
    .getByRole("button", { name: /^Approve/ })
    .focus();
  await page.keyboard.press("Enter");
  await expect(card(page, "noodles").locator(".operation-state")).toContainText(
    "Approved by you",
  );
  await expect(messageBox(page)).toBeEnabled();
  await expect(messageBox(page)).toBeFocused();
  lantern.push("card Lantern folded");
  await expectRows(page, [...fernwick, ...lantern]);
  await expectWaiting(page, 0);
  await expectTalkTo(page, LANTERN);

  // 3. Reload -----------------------------------------------------------
  await page.reload();
  // The asks are the page's own and a reload doesn't bring them back; the
  // messages and the folded cards come back in the same places.
  const noAsks: View = (list) => list.filter((row) => !row.startsWith("ask "));
  await expectRows(page, [...fernwick, ...lantern], noAsks);
  await expect(page.locator(".ask-block:not(.done)")).toHaveCount(0);
  await expect(card(page, "fernwick")).not.toHaveAttribute("open");
  await expect(card(page, "noodles")).not.toHaveAttribute("open");
  await expectWaiting(page, 0);
  await expectTalkTo(page, LANTERN);
  // Nothing takes the focus on a page load.
  await expect(messageBox(page)).not.toBeFocused();
});
