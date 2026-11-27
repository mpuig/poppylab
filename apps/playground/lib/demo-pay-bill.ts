/**
 * Protocol demo (no model): its one example across two Companies, "Pay my
 * Fernwick bill from checking." It reads the latest bill at the utility
 * and proposes its payment at the bank, from checking, to the utility's
 * saved recipient, with the bill's amount and reference.
 *
 * Each Company is recognised by its tools and its answers, never by its
 * name: the biller has `bills` with a `payment_reference` on each, the
 * bank `accounts`, `recipients` and `request_payment`, and the recipient
 * is the bank's saved one for the biller, with a `reference_format`. As
 * everywhere in the demo, every identifier comes from what was read.
 *
 * §10.1: the bank gets the amount, the reference and the bill's month in
 * the memo, and nothing else of the User's account at the utility; the
 * answer says so in one line, and "What Iris did" shows each call's
 * arguments.
 */
import { InvalidToolArguments } from "@poppy-lab/pap-client";
import { demoChangeReply, type DemoTools } from "./demo-changes";

/** One of the two Companies, as the script sees it. */
export type PayBillAt = {
  tools: DemoTools;
  name: string;
  /** Iris holds a sign-in there that the Company still takes. */
  signedIn: boolean;
};

const list = (value: unknown, key: string): Array<Record<string, unknown>> => {
  const items = (value as Record<string, unknown> | null | undefined)?.[key];
  return Array.isArray(items)
    ? items.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === "object",
      )
    : [];
};
const text = (value: unknown) => (typeof value === "string" ? value : "");
const refusal = (value: unknown) => {
  const error = (value as Record<string, unknown> | null | undefined)?.error;
  return typeof error === "string" ? error : undefined;
};
const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** "2026-10" as "October 2026"; "2026-11-21" as "21 November 2026". */
const month = (id: string) =>
  /^\d{4}-\d{2}$/.test(id)
    ? new Date(`${id}-01T00:00:00Z`).toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : id;
const day = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : date;
/** Names compared as their letters and digits, whatever the case. */
const same = (a: string, b: string) =>
  a.toLowerCase().replace(/[^a-z0-9]/g, "") ===
  b.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Why a read or a request was answered with an error, in plain words. */
const why = (error: string) =>
  error === "insufficient_scope"
    ? "your access there doesn't include the permission it needs"
    : error === "sign_in_required"
      ? "you're not signed in there"
      : `the answer was an error${/^[a-z_]{1,40}$/.test(error) ? ` (${error})` : ""}`;

/**
 * The script. `biller` is where the bill is read, `bank` where it is paid;
 * `show` puts a Company's answer into lines. It answers with what to say
 * and which of the two the answer is about: the one where something waits
 * for the User (a sign-in, a permission), or where it ended.
 */
export async function demoPayBill(
  biller: PayBillAt,
  bank: PayBillAt,
  /** A fresh idempotency key for the payment. */
  key: () => string,
  show: (answer: unknown) => string,
): Promise<{ at: "biller" | "bank"; text: string }> {
  const say = (at: "biller" | "bank", words: string) => ({
    at,
    text: `Protocol demo (no LLM). ${words}`,
  });
  const needs = `Paying your ${biller.name} bill from checking reads the bill at ${biller.name} and proposes the payment at ${bank.name}, so it needs you signed in at both.`;
  const untouched = `Iris didn't read your bill or ask ${bank.name} for anything.`;
  // Signed out, Iris stops before asking: the step says nothing was sent,
  // and the sign-in it waits for is under the answer.
  if (!biller.signedIn) {
    await biller.tools.bills?.execute();
    return say(
      "biller",
      `${needs} Sign in to ${biller.name} first${bank.signedIn ? "" : `, and then to ${bank.name}`}. ${untouched}`,
    );
  }
  if (!bank.signedIn) {
    await bank.tools.accounts?.execute();
    return say("bank", `${needs} Sign in to ${bank.name} too. ${untouched}`);
  }
  const pay = bank.tools.request_payment;
  if (
    !biller.tools.bills ||
    !bank.tools.accounts ||
    !bank.tools.recipients ||
    !pay
  )
    return say(
      "bank",
      `${biller.name} or ${bank.name} doesn't offer what this needs: bills at one, and accounts, saved recipients and payments at the other.`,
    );

  const read = await biller.tools.bills.execute();
  const unread = refusal(read);
  if (unread)
    return say(
      "biller",
      `The demo couldn't read your bills at ${biller.name}: ${why(unread)}. Nothing was sent to ${bank.name}.`,
    );
  // The latest month's bills, one for each meter, paid together under the
  // reference they share.
  const bills = list(read, "bills");
  const latest = bills
    .map((bill) => text(bill.period_start))
    .sort()
    .at(-1);
  const due = bills.filter((bill) => text(bill.period_start) === latest);
  const reference = text(due[0]?.payment_reference);
  if (!due.length || !reference)
    return say(
      "biller",
      `There is no closed bill with a payment reference at ${biller.name} to pay. Nothing was sent to ${bank.name}.`,
    );
  const amount = due.reduce(
    (sum, bill) =>
      sum + (typeof bill.total_cents === "number" ? bill.total_cents : 0),
    0,
  );
  const covers = month(text(due[0]!.id));
  if (amount <= 0)
    return say(
      "biller",
      `Your ${covers} bill at ${biller.name} comes to ${amount < 0 ? `a credit of ${usd(-amount)}` : usd(0)}, so there is nothing to pay. Nothing was sent to ${bank.name}.`,
    );

  const accounts = await bank.tools.accounts.execute();
  const recipients = await bank.tools.recipients.execute();
  const failed = refusal(accounts) ?? refusal(recipients);
  if (failed)
    return say(
      "bank",
      `The demo read your bill at ${biller.name}, but couldn't read your accounts at ${bank.name}: ${why(failed)}. It didn't ask ${bank.name} for the payment.`,
    );
  const active = list(accounts, "accounts").filter(
    (account) => account.status === "active",
  );
  const from = active.find((account) => account.type === "checking");
  if (!from)
    return say(
      "bank",
      `There is no active checking account at ${bank.name} to pay from. Nothing was sent to ${bank.name}.`,
    );
  const payee = list(recipients, "recipients").find(
    (recipient) =>
      recipient.status === "active" &&
      !!recipient.reference_format &&
      same(text(recipient.name), biller.name),
  );
  if (!payee)
    return say(
      "bank",
      `${bank.name} has no saved recipient for ${biller.name}, and Iris can't add one there. Nothing was sent to ${bank.name}.`,
    );
  const limit = payee.payment_limit_cents;
  if (typeof limit === "number" && amount > limit)
    return say(
      "bank",
      `The bill, ${usd(amount)}, is more than ${bank.name} pays ${text(payee.name)} in one payment, ${usd(limit)}. The demo didn't ask ${bank.name} for it.`,
    );

  const plan = {
    call: "request_payment",
    args: {
      source_account_id: from.id,
      recipient_id: payee.id,
      amount_cents: amount,
      memo: `Bill for ${covers}`,
      reference,
      idempotency_key: key(),
    },
    because: `The demo read your latest bill at ${biller.name}, for ${covers} and due on ${day(text(due[0]!.due_date))}, then your accounts and saved recipients at ${bank.name}, and asked ${bank.name} to pay ${text(payee.name)} ${usd(amount)} from ${text(from.name)}.\n\nFrom ${biller.name}, Iris sent ${bank.name} the bill's amount, ${usd(amount)}, its reference, ${reference}, and its month, ${covers}, in the memo, and nothing else.`,
  };
  try {
    return say(
      "bank",
      demoChangeReply(plan, await pay.execute(plan.args), show),
    );
  } catch (error) {
    if (!(error instanceof InvalidToolArguments)) throw error;
    return say(
      "bank",
      `The demo prepared a payment that ${bank.name}'s description of request_payment doesn't accept, so it didn't send it.`,
    );
  }
}
