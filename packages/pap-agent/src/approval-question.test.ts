import { describe, expect, it } from "vitest";
import {
  approvalQuestion,
  proposalName,
  spokenProposal,
  whichQuestion,
  withoutTerms,
} from "./approval-question";
import type { Language } from "./language";
import { changes, type ReviewOperation } from "./operation-presentation";

const now = Date.parse("2026-11-27T12:00:00Z");
const in10 = new Date(now + 10 * 60000).toISOString();
const op = (
  terms: Record<string, unknown>,
  summary?: string,
): ReviewOperation => ({
  operation_id: "op_1",
  revision: "r1",
  state: "proposed",
  expires_at: in10,
  terms,
  ...(summary ? { summary } : {}),
});

// As Lantern, Harborline, Juniper and Fernwick send them.
const order = op(
  {
    order_id: "ord_LNB1001",
    order_version: 3,
    from_slot: "sat-1230",
    to_slot: "sun-1300",
    lines: [{ dish_id: "matcha-ice", quantity: 1 }],
    before_total_cents: 7300,
    new_total_cents: 8800,
    price_difference_cents: 1500,
    currency: "USD",
    payment: "Simulated card on file — no real charge",
  },
  "Change order ord_LNB1001 for Elena. Reply YES to approve.",
);
const transfer = op({
  source_account_id: "acc_HLB_A100",
  destination_account_id: "acc_HLB_A200",
  amount_cents: 50000,
  idempotency_key: "k1",
  source_name: "Operating checking",
  destination_name: "Savings",
  source_balance_before_cents: 422000,
  source_balance_after_cents: 372000,
  destination_balance_before_cents: 100000,
  destination_balance_after_cents: 150000,
  currency: "USD",
});
const payment = op({
  source_account_id: "acc_HLB_A100",
  recipient_id: "rcp_1",
  amount_cents: 12500,
  memo: "quarterly report",
  recipient_name: "Beacon Studio",
  fee_cents: 0,
  currency: "USD",
});
const delivery = op({
  kind: "delivery",
  from: "Thursday",
  to: "Saturday",
  change_fee_cents: 0,
  currency: "USD",
});
// Nothing is paid, and the difference is the Company's estimate on a
// past month's usage.
const plan = op(
  {
    usage_point_id: "up_fpl_1001",
    meter: "Home",
    from_plan: "time_of_use",
    to_plan: "flat",
    from_plan_name: "Time of use",
    to_plan_name: "Flat rate",
    effective_date: "2026-12-01",
    estimate_basis_month: "2026-10",
    estimate_basis_kwh: "412.0",
    billed_cents: 9100,
    on_new_plan_cents: 12354,
    estimated_monthly_difference_cents: 3254,
    currency: "USD",
    meter_version: 2,
  },
  "Switch Home from Time of use to Flat rate. On October's usage the bill would have been USD 32.54 more.",
);

const ask = (proposal: ReviewOperation, company: string, language?: Language) =>
  approvalQuestion([{ op: proposal, company }], [], now, language)!;

describe("the agent's question about a proposal", () => {
  it("says the Company, what changes, the amount and the expiry, in its own words", () => {
    const asked = ask(order, "Lantern Noodle Bar");
    expect(asked.text).toBe(
      "Lantern Noodle Bar wants to change your order: the delivery slot from Saturday at 12:30 to Sunday at 13:00. The new total is $88.00, $15.00 more than before. It expires in 10 minutes. Shall I approve it?",
    );
    // Never the Company's prose as the question, and never a slot's code.
    expect(asked.text).not.toContain("Reply YES");
    expect(asked.text).not.toMatch(/sat-1230|sun-1300/);
    expect(asked.spoken).toBe(
      "Lantern Noodle Bar wants to change your order, for a new total of 88 dollars, 15 more. Shall I approve it?",
    );
  });

  it.each([
    [
      transfer,
      "Harborline Bank",
      "Harborline Bank wants to move $500.00 from Operating checking to Savings. It expires in 10 minutes. Shall I approve it?",
      "Harborline Bank wants to move 500 dollars from Operating checking to Savings. Shall I approve it?",
    ],
    [
      payment,
      "Harborline Bank",
      "Harborline Bank wants to pay Beacon Studio $125.00. It expires in 10 minutes. Shall I approve it?",
      "Harborline Bank wants to pay Beacon Studio 125 dollars. Shall I approve it?",
    ],
    [
      delivery,
      "Juniper Market",
      "Juniper Market wants to change your recurring delivery day from Thursday to Saturday. There's no fee. It expires in 10 minutes. Shall I approve it?",
      "Juniper Market wants to change your recurring delivery day from Thursday to Saturday. Shall I approve it?",
    ],
  ])("asks about %#", (proposal, company, text, spoken) => {
    const asked = ask(proposal, company);
    expect(asked.text).toBe(text);
    expect(asked.spoken).toBe(spoken);
  });

  it("says there is nothing to pay now, and gives an estimate as the Company's", () => {
    const asked = ask(plan, "Fernwick Power & Light");
    expect(asked.text).toBe(
      "Fernwick Power & Light wants to change your plan from Time of use to Flat rate, starting 1 December. Nothing to pay now; Fernwick Power & Light estimates it would have cost $32.54 more in October. It expires in 10 minutes. Shall I approve it?",
    );
    expect(asked.text).not.toContain("no amount");
    expect(asked.spoken).toBe(
      "Fernwick Power & Light wants to change your plan from Time of use to Flat rate, starting 1 December, with nothing to pay now. Shall I approve it?",
    );
  });

  it("names each when another waits too, and asks which", () => {
    const asked = approvalQuestion(
      [{ op: transfer, company: "Harborline Bank" }],
      [{ op: order, company: "Lantern Noodle Bar" }],
      now,
    )!;
    expect(asked.text).toBe(
      "Harborline Bank wants to move $500.00 from Operating checking to Savings. It expires in 10 minutes. The $88.00 change at Lantern Noodle Bar is waiting for you too. Which one should I approve: the $500.00 transfer at Harborline Bank or the $88.00 change at Lantern Noodle Bar?",
    );
    expect(asked.spoken).toBe(
      "Harborline Bank wants to move 500 dollars from Operating checking to Savings. Which one should I approve: the transfer of 500 dollars at Harborline Bank or the change of 88 dollars at Lantern Noodle Bar?",
    );
    expect(
      whichQuestion(
        [
          { op: order, company: "Lantern Noodle Bar" },
          { op: transfer, company: "Harborline Bank" },
        ],
        "approve",
      ).text,
    ).toBe(
      "Which one do you want to approve: the $88.00 change at Lantern Noodle Bar or the $500.00 transfer at Harborline Bank? You can say the company or the amount.",
    );
  });

  it("tells proposals apart by amount, kind and Company", () => {
    expect(proposalName(order, "Lantern Noodle Bar")).toBe(
      "the $88.00 change at Lantern Noodle Bar",
    );
    expect(proposalName(delivery, "Juniper Market")).toBe(
      "the change at Juniper Market",
    );
    expect(spokenProposal(transfer, "Harborline Bank")).not.toMatch(/acc_|k1/);
  });
});

/**
 * The same questions in each language the agent speaks: the facts (the
 * Company, the amounts, the before and after, the expiry) are the terms'
 * own in every one of them; only the sentence around them changes.
 */
describe("the question in the conversation's language", () => {
  it.each([
    [
      "es",
      order,
      "Lantern Noodle Bar",
      "Lantern Noodle Bar quiere cambiar tu pedido: la franja de entrega del sábado a las 12:30 al domingo a las 13:00. El total nuevo es de $88.00, $15.00 más que antes. Caduca en 10 minutos. ¿Lo apruebo?",
      "Lantern Noodle Bar quiere cambiar tu pedido, por un total nuevo de 88 dólares, 15 más. ¿Lo apruebo?",
    ],
    [
      "es",
      plan,
      "Fernwick Power & Light",
      "Fernwick Power & Light quiere cambiar tu tarifa de Time of use a Flat rate, a partir del 1 de diciembre. Ahora no hay nada que pagar; Fernwick Power & Light calcula que en octubre habría costado $32.54 más. Caduca en 10 minutos. ¿Lo apruebo?",
      "Fernwick Power & Light quiere cambiar tu tarifa de Time of use a Flat rate, a partir del 1 de diciembre, sin nada que pagar ahora. ¿Lo apruebo?",
    ],
    [
      "es",
      delivery,
      "Juniper Market",
      "Juniper Market quiere cambiar el día de tu entrega periódica del jueves al sábado. No hay comisión. Caduca en 10 minutos. ¿Lo apruebo?",
      "Juniper Market quiere cambiar el día de tu entrega periódica del jueves al sábado. ¿Lo apruebo?",
    ],
    [
      "ca",
      order,
      "Lantern Noodle Bar",
      "Lantern Noodle Bar vol canviar la teva comanda: la franja d'entrega de dissabte a les 12:30 a diumenge a les 13:00. El total nou és de $88.00, $15.00 més que abans. Caduca d'aquí a 10 minuts. L'aprovo?",
      "Lantern Noodle Bar vol canviar la teva comanda, per un total nou de 88 dòlars, 15 més. L'aprovo?",
    ],
    [
      "ca",
      transfer,
      "Harborline Bank",
      "Harborline Bank vol transferir $500.00 d'Operating checking a Savings. Caduca d'aquí a 10 minuts. L'aprovo?",
      "Harborline Bank vol transferir 500 dòlars d'Operating checking a Savings. L'aprovo?",
    ],
    [
      "ca",
      plan,
      "Fernwick Power & Light",
      "Fernwick Power & Light vol canviar la teva tarifa de Time of use a Flat rate, a partir del dia 1 de desembre. Ara no cal pagar res; Fernwick Power & Light calcula que el mes d'octubre hauria costat $32.54 més. Caduca d'aquí a 10 minuts. L'aprovo?",
      "Fernwick Power & Light vol canviar la teva tarifa de Time of use a Flat rate, a partir del dia 1 de desembre, sense res a pagar ara. L'aprovo?",
    ],
    [
      "fr",
      order,
      "Lantern Noodle Bar",
      "Lantern Noodle Bar veut modifier votre commande : le créneau de livraison du samedi à 12h30 au dimanche à 13h00. Le nouveau total est de $88.00, soit $15.00 de plus qu'avant. La proposition expire dans 10 minutes. Je l'approuve ?",
      "Lantern Noodle Bar veut modifier votre commande, pour un nouveau total de 88 dollars, 15 de plus. Je l'approuve ?",
    ],
    [
      "fr",
      payment,
      "Harborline Bank",
      "Harborline Bank veut payer $125.00 à Beacon Studio. La proposition expire dans 10 minutes. Je l'approuve ?",
      "Harborline Bank veut payer 125 dollars à Beacon Studio. Je l'approuve ?",
    ],
    [
      "fr",
      plan,
      "Fernwick Power & Light",
      "Fernwick Power & Light veut modifier votre offre de Time of use à Flat rate, à partir du 1er décembre. Rien à payer maintenant ; Fernwick Power & Light estime qu'en octobre, cela aurait coûté $32.54 de plus. La proposition expire dans 10 minutes. Je l'approuve ?",
      "Fernwick Power & Light veut modifier votre offre de Time of use à Flat rate, à partir du 1er décembre, sans rien à payer maintenant. Je l'approuve ?",
    ],
  ] as const)("in %s: %#", (language, proposal, company, text, spoken) => {
    const asked = ask(proposal, company, language);
    expect(asked.text).toBe(text);
    expect(asked.spoken).toBe(spoken);
  });

  it("asks which, naming each, in each language", () => {
    const two = (language: Language) =>
      approvalQuestion(
        [{ op: transfer, company: "Harborline Bank" }],
        [{ op: order, company: "Lantern Noodle Bar" }],
        now,
        language,
      )!.text;
    expect(two("es")).toBe(
      "Harborline Bank quiere transferir $500.00 de Operating checking a Savings. Caduca en 10 minutos. También te espera el cambio de $88.00 en Lantern Noodle Bar. ¿Cuál apruebo: la transferencia de $500.00 en Harborline Bank o el cambio de $88.00 en Lantern Noodle Bar?",
    );
    expect(two("ca")).toContain(
      "També t'espera el canvi de $88.00 a Lantern Noodle Bar. Quina aprovo: la transferència de $500.00 a Harborline Bank o el canvi de $88.00 a Lantern Noodle Bar?",
    );
    expect(two("fr")).toContain(
      "La modification de $88.00 chez Lantern Noodle Bar vous attend aussi. Laquelle dois-je approuver : le virement de $500.00 chez Harborline Bank ou la modification de $88.00 chez Lantern Noodle Bar ?",
    );
    expect(
      whichQuestion(
        [
          { op: order, company: "Lantern Noodle Bar" },
          { op: transfer, company: "Harborline Bank" },
        ],
        "decline",
        "es",
      ).text,
    ).toBe(
      "¿Cuál quieres rechazar: el cambio de $88.00 en Lantern Noodle Bar o la transferencia de $500.00 en Harborline Bank? Puedes decir la empresa o el importe.",
    );
  });

  it("keeps every fact exact in every language", () => {
    for (const language of ["en", "es", "ca", "fr"] as const) {
      const lantern = ask(order, "Lantern Noodle Bar", language).text;
      for (const fact of ["Lantern Noodle Bar", "$88.00", "$15.00", "12", "13"])
        expect(lantern).toContain(fact);
      const fernwick = ask(plan, "Fernwick Power & Light", language).text;
      for (const fact of ["Time of use", "Flat rate", "$32.54", "10"])
        expect(fernwick).toContain(fact);
      // The estimate stays the Company's: its name is in the sentence.
      expect(fernwick.match(/Fernwick Power & Light/g)).toHaveLength(2);
    }
  });
});

describe("a delivery slot, said as its day and time", () => {
  it("never shows a slot's code, in the question or aloud", () => {
    const friday = op({
      order_id: "ord_2",
      from_slot: "fri-1830",
      to_slot: "sun-1300",
      before_total_cents: 7300,
      new_total_cents: 7300,
      currency: "USD",
    });
    const asked = ask(friday, "Lantern Noodle Bar");
    expect(asked.text).toBe(
      "Lantern Noodle Bar wants to change your order: the delivery slot from Friday at 18:30 to Sunday at 13:00. The total stays at $73.00. It expires in 10 minutes. Shall I approve it?",
    );
    expect(`${asked.text} ${asked.spoken}`).not.toMatch(/fri-1830|sun-1300/);
    expect(ask(friday, "Lantern Noodle Bar", "es").text).toContain(
      "del viernes a las 18:30 al domingo a las 13:00",
    );
  });
});

describe("an order change that adds or takes away dishes", () => {
  const dishes = op({
    order_id: "ord_LNB1001",
    order_version: 3,
    from_slot: "fri-1830",
    to_slot: "sun-1300",
    lines: { "shoyu-ramen": 2, edamame: 1, "matcha-ice": 1 },
    from_items: [
      { name: "Shoyu ramen", quantity: 2 },
      { name: "Salted edamame", quantity: 1 },
      { name: "Pork gyoza", quantity: 1 },
    ],
    to_items: [
      { name: "Shoyu ramen", quantity: 2 },
      { name: "Salted edamame", quantity: 1 },
      { name: "Matcha ice cream", quantity: 1 },
    ],
    before_total_cents: 3700,
    new_total_cents: 4300,
    currency: "USD",
  });

  it("names each dish it adds or takes away, in the Company's words, in every language", () => {
    const text = (language: Language) =>
      approvalQuestion(
        [{ op: dishes, company: "Lantern Noodle Bar" }],
        [],
        now,
        language,
      )!.text;
    expect(text("en")).toMatch(
      /^Lantern Noodle Bar wants to change your order: remove 1 × Pork gyoza, add 1 × Matcha ice cream, and the delivery slot from Friday at 18:30 to Sunday at 13:00\./,
    );
    expect(text("es")).toContain(
      "quitar 1 × Pork gyoza, añadir 1 × Matcha ice cream, y la franja de entrega",
    );
    expect(text("ca")).toContain("afegir 1 × Matcha ice cream");
    expect(text("fr")).toContain("ajouter 1 × Matcha ice cream");
    // The card lists them too, before and after.
    expect(changes(dishes)).toEqual([
      expect.objectContaining({
        label: "Pork gyoza",
        before: "1",
        after: "Removed",
      }),
      expect.objectContaining({
        label: "Matcha ice cream",
        before: "Not in the order",
        after: "1",
      }),
      expect.objectContaining({ label: "Delivery slot" }),
    ]);
  });

  it("leaves out of a model's answer what restates the terms, and keeps the rest", () => {
    expect(
      withoutTerms(
        "Lantern Noodle Bar tiene listo el cambio: añade un Matcha ice cream y pasa el pedido al domingo a las 13:00. El total sube de $37.00 a $43.00; aprueba estos términos si te parecen bien. Lo lleva el mismo repartidor.",
        [dishes],
        "es",
      ),
    ).toBe("Lo lleva el mismo repartidor.");
    expect(
      withoutTerms("The new total is $43.00. Shall I approve it?", [dishes]),
    ).toBe("");
  });
});
