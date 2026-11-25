/**
 * A fictional statement as a small PDF 1.4 file, written by hand: no
 * dependency, no compression, no clock and no random IDs, so the same
 * statement is always the same bytes. Letter pages, the two standard
 * Helvetica fonts (which a PDF reader supplies), WinAnsi text written as
 * ASCII escapes, and a cross-reference table with exact byte offsets.
 *
 * At most `MAX_STATEMENT_ROWS` transactions are printed; the PDF says so
 * when a cycle has more. Every page says that no real account exists.
 */
import type { Account } from "./data.ts";
import { accountLast4, FICTION_NOTICE } from "./data.ts";
import type { Statement } from "./statements.ts";

/** Transactions printed on one statement. */
export const MAX_STATEMENT_ROWS = 100;
export const STATEMENT_TITLE = "Harborline Bank — fictional statement";
export const NO_REAL_ACCOUNT =
  "No real account exists. This statement is invented demo data.";

const PAGE = { width: 612, height: 792, margin: 54 } as const;
const ROW = 14;
const BOTTOM = 72;
/** Right edges of the amount and balance columns. */
const AMOUNT_RIGHT = 450,
  BALANCE_RIGHT = PAGE.width - PAGE.margin;
const DESCRIPTION_CHARS = 44;

/** WinAnsi codes for the few characters beyond Latin-1 that we print. */
const WIN_ANSI: Record<string, number> = {
  "—": 0x97,
  "–": 0x96,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "…": 0x85,
};

/**
 * A PDF string literal in WinAnsi: printable ASCII as it is, other
 * characters the encoding has as octal escapes, and anything else as `?`.
 * The file stays ASCII, so byte offsets are string offsets.
 */
export function pdfString(text: string) {
  let out = "(";
  for (const ch of text.replace(/−/g, "-")) {
    const code = ch.codePointAt(0)!;
    const byte =
      code >= 0x20 && code < 0x7f
        ? code
        : WIN_ANSI[ch] !== undefined
          ? WIN_ANSI[ch]
          : code >= 0xa0 && code <= 0xff
            ? code
            : 0x3f;
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c)
      out += `\\${String.fromCharCode(byte)}`;
    else if (byte < 0x7f) out += String.fromCharCode(byte);
    else out += `\\${byte.toString(8).padStart(3, "0")}`;
  }
  return `${out})`;
}

/** Helvetica advance widths (per 1000 em) of the characters in amounts. */
const NUMBER_WIDTHS: Record<string, number> = {
  ",": 278,
  ".": 278,
  "-": 333,
  " ": 278,
};
const numberWidth = (text: string, size: number) =>
  ([...text].reduce((sum, ch) => sum + (NUMBER_WIDTHS[ch] ?? 556), 0) * size) /
  1000;

/** Cents as `1,234.56`, signed, built from the digits. */
export function amount(cents: number) {
  const whole = Math.abs(cents);
  const units = String(Math.trunc(whole / 100)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ",",
  );
  return `${cents < 0 ? "-" : ""}${units}.${String(whole % 100).padStart(2, "0")}`;
}

/** A coordinate, to two decimals at most. */
const n = (value: number) => String(Number(value.toFixed(2)));
type Font = "F1" | "F2";
const text = (font: Font, size: number, x: number, y: number, s: string) =>
  `BT /${font} ${size} Tf ${n(x)} ${n(y)} Td ${pdfString(s)} Tj ET`;
const right = (size: number, edge: number, y: number, s: string) =>
  text("F1", size, edge - numberWidth(s, size), y, s);
const clip = (s: string, max: number) =>
  s.length > max ? `${s.slice(0, max - 3).trimEnd()}...` : s;

/** The page contents, as content-stream lines per page. */
function pages(
  statement: Statement,
  account: Pick<Account, "id" | "name">,
  customer: string,
) {
  const out: string[][] = [];
  let lines: string[] = [];
  let y = 0;
  const tableHeader = (top: number) => {
    lines.push(
      text("F2", 9, PAGE.margin, top, "Date"),
      text("F2", 9, 130, top, "Description"),
      text("F2", 9, AMOUNT_RIGHT - 62, top, "Amount (USD)"),
      text("F2", 9, BALANCE_RIGHT - 66, top, "Balance (USD)"),
      `0.5 w ${PAGE.margin} ${top - 6} m ${BALANCE_RIGHT} ${top - 6} l S`,
    );
    y = top - 20;
  };
  const newPage = () => {
    if (lines.length) out.push(lines);
    lines = [];
    const top = PAGE.height - PAGE.margin;
    if (!out.length) {
      lines.push(
        text("F2", 16, PAGE.margin, top, STATEMENT_TITLE),
        // The fiction notice, boxed, before anything else.
        `0.92 g ${PAGE.margin} ${top - 52} ${PAGE.width - 2 * PAGE.margin} 36 re f 0 g`,
        text("F2", 10, PAGE.margin + 8, top - 30, NO_REAL_ACCOUNT),
        text("F1", 9, PAGE.margin + 8, top - 44, FICTION_NOTICE),
        text(
          "F1",
          11,
          PAGE.margin,
          top - 76,
          `Account: ${account.name} • ending ${accountLast4(account.id)}`,
        ),
        text("F1", 11, PAGE.margin, top - 92, `Customer: ${customer}`),
        text(
          "F1",
          11,
          PAGE.margin,
          top - 108,
          `Period: ${statement.startDate} to ${statement.endDate} (UTC days) • Statement date: ${statement.endDate}`,
        ),
        text(
          "F1",
          9,
          PAGE.margin,
          top - 124,
          `Statement ID: ${statement.statementId}`,
        ),
      );
      const credits = statement.transactions
        .filter((t) => t.amount_cents > 0)
        .reduce((sum, t) => sum + t.amount_cents, 0);
      const debits = statement.transactions
        .filter((t) => t.amount_cents < 0)
        .reduce((sum, t) => sum + t.amount_cents, 0);
      const summary: Array<[string, number]> = [
        ["Opening balance", statement.openingCents],
        ["Credits", credits],
        ["Debits", debits],
        ["Closing balance", statement.closingCents],
      ];
      summary.forEach(([label, cents], i) => {
        const at = top - 148 - i * ROW;
        lines.push(
          text(i === 3 ? "F2" : "F1", 10, PAGE.margin, at, label),
          right(10, 300, at, `USD ${amount(cents)}`),
        );
      });
      tableHeader(top - 222);
    } else {
      lines.push(
        text("F2", 12, PAGE.margin, top, `${STATEMENT_TITLE} (continued)`),
        text("F1", 9, PAGE.margin, top - 16, NO_REAL_ACCOUNT),
      );
      tableHeader(top - 40);
    }
  };
  /** One table line, on a new page when this one is full. */
  const row = (draw: (at: number) => string[]) => {
    if (y < BOTTOM) newPage();
    lines.push(...draw(y));
    y -= ROW;
  };

  newPage();
  const shown = statement.transactions.slice(0, MAX_STATEMENT_ROWS);
  let balance = statement.openingCents;
  if (!shown.length)
    row((at) => [
      text("F1", 9, PAGE.margin, at, "No posted transactions in this period."),
    ]);
  for (const t of shown) {
    balance += t.amount_cents;
    const after = balance;
    row((at) => [
      text("F1", 9, PAGE.margin, at, t.occurred_at.slice(0, 10)),
      text("F1", 9, 130, at, clip(t.description, DESCRIPTION_CHARS)),
      right(9, AMOUNT_RIGHT, at, amount(t.amount_cents)),
      right(9, BALANCE_RIGHT, at, amount(after)),
    ]);
  }
  if (statement.transactions.length > shown.length)
    row((at) => [
      text(
        "F2",
        9,
        PAGE.margin,
        at,
        `Showing the first ${shown.length} of ${statement.transactions.length} posted transactions in this period.`,
      ),
    ]);
  out.push(lines);
  return out;
}

/** The statement as PDF bytes: the same statement, the same bytes. */
export function statementPdf(
  statement: Statement,
  account: Pick<Account, "id" | "name">,
  customer: string,
): Uint8Array {
  const contents = pages(statement, account, customer);
  const count = contents.length;
  const footer = (i: number) =>
    text(
      "F1",
      8,
      PAGE.margin,
      40,
      `Page ${i + 1} of ${count} • ${statement.statementId} • FDX-shaped, not FDX-conformant or certified • No real account exists.`,
    );
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${contents.map((_, i) => `${5 + 2 * i} 0 R`).join(" ")}] /Count ${count} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  contents.forEach((lines, i) => {
    const stream = [...lines, footer(i)].join("\n");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + 2 * i} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });
  objects.push(
    // Document info strings aren't WinAnsi: ASCII only.
    `<< /Title ${pdfString(`Harborline Bank fictional statement, ${statement.endDate}`)} /Producer (Harborline Bank, Poppy Lab) >>`,
  );
  // A binary comment after the header, as files with 8-bit data carry.
  let file = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(file.length);
    file += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = file.length;
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    file += `${String(offset).padStart(10, "0")} 00000 n \n`;
  file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(file.length);
  for (let i = 0; i < file.length; i++) bytes[i] = file.charCodeAt(i);
  return bytes;
}
