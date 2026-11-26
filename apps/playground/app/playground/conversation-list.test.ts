import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompaniesOf } from "./conversation-list";

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
