import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CompaniesOf,
  ConversationList,
  readConversations,
} from "./conversation-list";

const row = (item: Parameters<typeof CompaniesOf>[0]["item"]) =>
  renderToStaticMarkup(createElement(CompaniesOf, { item }));

it("lists a conversation with every Company it has, and one with none", () => {
  const html = row({
    company: "Lantern Noodle Bar, Harborline Bank",
    companies: [
      {
        origin: "https://lantern.example",
        name: "Lantern Noodle Bar",
        url: "",
      },
      { origin: "https://harbor.example", name: "Harborline Bank", url: "" },
    ],
  });
  expect(html).toMatch(
    /Lantern Noodle Bar<\/span><span class="separator"> · <\/span><span class="history-company"><span class="company-mark other" aria-hidden="true"><\/span>Harborline Bank/,
  );
  // A list kept before conversations named their Companies says it in one line.
  expect(row({ company: "Juniper Market" })).toBe(
    "<strong>Juniper Market</strong>",
  );
  expect(row({ company: "No company yet", companies: [] })).toBe(
    "<strong>No company yet</strong>",
  );
});

it("reads a refused list as an error, not as no conversations", async () => {
  // The route refuses a request from another origin, or past its budget,
  // with an error body and no list in it.
  await expect(
    readConversations(
      Response.json(
        { error: "Same-origin browser requests required" },
        { status: 403 },
      ),
    ),
  ).rejects.toThrow();
  await expect(
    readConversations(Response.json({ error: "Busy" }, { status: 429 })),
  ).rejects.toThrow();
  const item = {
    id: "run_1",
    company: "Lantern Noodle Bar",
    created: 1,
    active: true,
    until: 2,
  };
  expect(
    await readConversations(Response.json({ conversations: [item] })),
  ).toEqual([item]);
  expect(await readConversations(Response.json({}))).toEqual([]);
});

it("lists a Company removed from the conversation, marked as removed", () => {
  const html = row({
    company: "No company yet",
    companies: [
      {
        origin: "https://lantern.example",
        name: "Lantern Noodle Bar",
        url: "",
        removed: true,
      },
    ],
  });
  expect(html).toBe(
    '<strong><span class="history-company"><span class="company-mark other" aria-hidden="true"></span>Lantern Noodle Bar<span class="removed">(removed)</span></span></strong>',
  );
});

it("says that starting over removes the standing instructions", () => {
  const html = renderToStaticMarkup(
    createElement(ConversationList, { current: undefined, onReset: () => {} }),
  );
  expect(html).toMatch(
    /ends\s+the conversations that are open and removes your standing\s+instructions/,
  );
});
