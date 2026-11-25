import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FdxStatements, type FdxStatementAccount } from "./fdx-statements";

const html = (accounts: FdxStatementAccount[] | undefined) =>
  renderToStaticMarkup(
    createElement(FdxStatements, {
      accounts,
      disabled: false,
      onList: () => {},
      onDownload: () => {},
    }),
  );

describe("FDX statements in the account row", () => {
  it("offers to list them first, then a download per statement, saying Iris doesn't read them", () => {
    expect(html(undefined)).toContain("Show FDX statements");
    const listed = html([
      {
        accountId: "acc_HLB_A100",
        productName: "Operating checking",
        accountNumberDisplay: "0479",
        statements: [
          {
            statementId: "stmt_acc_HLB_A100_20261120",
            statementDate: "2026-11-20",
            description: "Monthly statement, 2026-10-21 to 2026-11-20",
          },
        ],
      },
      { accountId: "acc_HLB_A200", statements: [] },
      { error: "The bank didn't return the statements as expected." },
    ]);
    expect(listed).toContain("Operating checking");
    expect(listed).toContain("···0479");
    expect(listed).toContain("Monthly statement, 2026-10-21 to 2026-11-20");
    expect(listed.match(/Download PDF/g)).toHaveLength(1);
    expect(listed).toContain("Iris doesn&#x27;t read them");
    expect(listed).toContain("No statements yet.");
    expect(listed).toContain("didn&#x27;t return the statements");
    expect(html([])).toContain("No shared accounts.");
  });
});
