import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { inlineText } from "./inline-text";

const html = (text: string) =>
  renderToStaticMarkup(createElement(Fragment, null, ...inlineText(text)));

it("renders the model's bold and code marks as elements, and escapes everything else", () => {
  expect(html("Call **+1 555-0117** or use `report_unsupported_task`.")).toBe(
    "Call <strong>+1 555-0117</strong> or use <code>report_unsupported_task</code>.",
  );
  expect(html("**<img src=x onerror=alert(1)>**")).toBe(
    "<strong>&lt;img src=x onerror=alert(1)&gt;</strong>",
  );
  // Unpaired or empty marks stay as written.
  expect(html("2 ** 3 and **** and `")).toBe("2 ** 3 and **** and `");
});
