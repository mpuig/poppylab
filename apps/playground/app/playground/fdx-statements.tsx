"use client";

/** One shared account's statements, as the `fdx_statements` action lists them. */
export type FdxStatementAccount = {
  accountId?: string;
  productName?: string;
  accountNumberDisplay?: string;
  statements?: Array<{
    statementId?: string;
    statementDate?: string;
    description?: string;
  }>;
  /** The bank didn't list this account's statements. */
  error?: string;
};

/**
 * `poppylab.dev/fdx` v1: the shared accounts' statements, for the User to
 * download as PDFs (`fdx_statement`). Iris never reads the files.
 */
export function FdxStatements({
  accounts,
  disabled,
  onList,
  onDownload,
}: {
  /** Undefined until the User asks for them. */
  accounts: FdxStatementAccount[] | undefined;
  disabled: boolean;
  onList: () => void;
  onDownload: (accountId: string, statementId: string) => void;
}) {
  return (
    <div className="fdx-statements">
      {accounts === undefined ? (
        <button
          type="button"
          className="ghost-button"
          disabled={disabled}
          onClick={onList}
        >
          Show FDX statements
        </button>
      ) : (
        <>
          <p>
            Statements of the accounts you shared
            <span className="quiet">
              {" "}
              · PDFs for you to download; Iris doesn&apos;t read them
            </span>
          </p>
          {!accounts.length && <p className="quiet">No shared accounts.</p>}
          {accounts.map((account, index) => (
            <div
              key={account.accountId ?? index}
              className="fdx-statement-account"
            >
              <p>
                <strong>
                  {account.productName ?? account.accountId ?? "Account"}
                </strong>
                {account.accountNumberDisplay && (
                  <span className="quiet">
                    {" "}
                    ···{account.accountNumberDisplay}
                  </span>
                )}
              </p>
              {account.error ? (
                <p className="quiet">{account.error}</p>
              ) : !account.statements?.length ? (
                <p className="quiet">No statements yet.</p>
              ) : (
                <ul>
                  {account.statements.map((statement) =>
                    statement.statementId && account.accountId ? (
                      <li key={statement.statementId}>
                        <span>
                          {statement.description ??
                            statement.statementDate ??
                            statement.statementId}
                        </span>
                        <button
                          type="button"
                          className="text-button"
                          disabled={disabled}
                          onClick={() =>
                            onDownload(
                              account.accountId!,
                              statement.statementId!,
                            )
                          }
                        >
                          Download PDF
                        </button>
                      </li>
                    ) : null,
                  )}
                </ul>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
