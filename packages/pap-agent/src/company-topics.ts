/**
 * What a message is about, matched against what each connected Company
 * publishes about what it does: how it describes its APIs and its agent
 * (§3.1, §8.1), what each of its permissions covers, the skills it lists
 * (§9.4), and the tools its last turn loaded, with the values they take
 * ("pork-gyoza"). "What is the menu today?" is about Lantern Noodle Bar's
 * menu, "¿cuál es mi saldo?" about Harborline Bank's balances.
 *
 * A word counts for a Company only when no other Company of the
 * conversation uses it too: words they all use ("account", "read") say
 * nothing about which one is meant. The User's words in Spanish, Catalan
 * and French are read in English too, by a short fixed list of the words
 * people use for the lab's kinds of tasks, since the Companies describe
 * themselves in English.
 *
 * Only ever a choice among the connected Companies given: nothing here
 * turns words into an address. What a Company says about itself is Company
 * content, read here as words to compare and nothing else (§10.1).
 *
 * Plain data and no I/O.
 */
import type { Connection } from "./runtime";

/** Lower case, without accents, a word at a time; numbers left out. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !/\d/.test(word));
}

/** "dishes" and "dish", "deliveries" and "delivery", read as one word. */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (/(?:sses|shes|ches|xes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss"))
    return word.slice(0, -1);
  return word;
}

const list = (text: string) => text.trim().split(/\s+/);

/**
 * Words that say nothing about which Company a request is for: the
 * common words of English, what any request asks (read, change, send)
 * and the words of the protocol itself.
 */
const GENERIC = new Set(
  list(`
    the and for with from that this these those what whats which who whom
    how when where why there here your you yours our ours their them they
    its into onto over under about after before also just only than
    then too very can could would should will shall may might must does did
    done doing have has had having are was were been being not nor any all
    some each every one two other another same more most less least much
    many such own today tomorrow yesterday now please thanks thank hello
    yes yeah okay sure want need like let get got give show tell see look
    read list find know check help ask make made set put take send sent
    use used using add adding remove removing move moving change changes
    changing update updating cancel keep open close start stop try again
    first last next new old current latest public private fictional
    simulated real exact only data api apis tool tools mcp operation
    operations request requests structured agent agents automated personal
    customer customers user users company companies account accounts sign
    signed approve approval approves approved propose proposal proposes
    include includes doesn cant won undone cost costs price prices total
    totals item items thing things way part parts kind status detail
    details info information summary view shape support supported
    supports handle handles answer answers ids permission permissions
    scope scopes browser website site page web own nothing anything
    something everything url uri http https json cent cents usd
  `).map(stem),
);

/**
 * The words people use with the lab's Companies in Spanish, Catalan and
 * French, each with the English word a Company describes the same thing
 * by. A word that means two things is read as both ("carte").
 */
const ENGLISH: Record<string, readonly string[]> = Object.fromEntries(
  (
    [
      ["menu", "carta carte menus"],
      ["dish", "plato platos plat plats platillo platillos"],
      ["noodle", "fideo fideos fideu fideus nouille nouilles"],
      [
        "delivery",
        "entrega entregas reparto envio lliurament lliuraments livraison livraisons domicilio",
      ],
      ["slot", "franja franjas creneau creneaux"],
      ["hour", "horario horarios horari horaris horaire horaires"],
      ["opening", "apertura obertura ouverture"],
      ["order", "pedido pedidos comanda comandes commande commandes encargo"],
      [
        "refund",
        "reembolso reembolsar devolucion reemborsament reemborsar devolucio remboursement rembourser",
      ],
      ["missing", "falta faltaba faltan faltava faltaven manque manquait"],
      ["balance", "saldo saldos solde soldes"],
      [
        "transfer",
        "transferencia transferencias transferir transfiere transfereix traspaso traspas traspassar virement virements virer",
      ],
      ["checking", "corriente corrent"],
      ["saving", "ahorro ahorros estalvi estalvis epargne"],
      ["card", "tarjeta tarjetas targeta targetes carte cartes"],
      [
        "transaction",
        "movimiento movimientos moviment moviments transaccion transacciones transaccio transaccions",
      ],
      ["spending", "gasto gastos despesa despeses depense depenses"],
      ["budget", "presupuesto presupuestos pressupost pressupostos"],
      ["payment", "pago pagos pagament pagaments paiement paiements"],
      [
        "recipient",
        "destinatario destinatarios destinatari destinataris beneficiario beneficiari beneficiaire",
      ],
      ["bill", "factura facturas factures facture"],
      ["flight", "vuelo vuelos vol vols"],
      ["baggage", "equipaje equipatge bagage bagages maleta maletas"],
      ["trip", "viaje viajes viatge viatges voyage voyages"],
      ["seat", "asiento asientos seient seients siege sieges"],
      ["usage", "consumo consum consommation"],
      ["meter", "contador comptador compteur"],
      ["electricity", "electricidad electricitat electricite luz llum"],
      ["outage", "apagon apagada panne coupure"],
      ["basket", "cesta carrito cistella panier"],
      ["product", "producto productos producte productes produit produits"],
      ["grocery", "compra compras courses epicerie"],
      // English verbs, said of what a Company names by a noun.
      ["delivery", "deliver delivered delivering"],
      ["payment", "pay paid paying"],
      ["spending", "spend spent"],
      ["flight", "fly flying flew"],
    ] as const
  ).flatMap(([english, said]) =>
    list(said).map((word) => [word, [english]] as const),
  ),
);
// "carte" is both a menu and a card.
ENGLISH.carte = ["menu", "card"];
ENGLISH.cartes = ["menu", "card"];

/** The words of a message, each as a Company would say it in English. */
function said(message: string): Set<string> {
  const out = new Set<string>();
  for (const word of words(message)) {
    for (const english of ENGLISH[word] ?? ENGLISH[stem(word)] ?? [stem(word)])
      if (!GENERIC.has(english)) out.add(english);
  }
  return out;
}

/**
 * What a connected Company publishes about what it does, as words. The
 * tasks it says it doesn't offer are left out: they say what it doesn't
 * do.
 */
export function publishedWords(connection: Connection): Set<string> {
  const document = connection.company?.document;
  const tasks =
    connection.tasks?.sid === connection.sessionId
      ? (connection.tasks?.value.skills ?? [])
      : [];
  const texts = [
    ...(document?.apis ?? []).map((api) => api.description),
    ...(document?.agent?.protocols ?? []).map((entry) => entry.description),
    ...Object.values(document?.auth?.scopes ?? {}),
    ...tasks.flatMap((skill) => [skill.name, skill.description]),
    ...(connection.offered ?? []).flatMap((tool) => [
      tool.name,
      tool.description,
      ...(tool.values ?? []),
    ]),
  ];
  const out = new Set<string>();
  for (const text of texts)
    for (const word of words(text)) {
      const stemmed = stem(word);
      if (!GENERIC.has(stemmed)) out.add(stemmed);
    }
  return out;
}

/**
 * For each Company, in the order given, how many of the message's words
 * it publishes (`any`), and how many of those it alone of them does
 * (`alone`). "When can you deliver?" fits a shop and a restaurant that
 * both deliver, and neither alone.
 */
export function topicFit(
  message: string,
  connections: readonly Connection[],
): { any: number[]; alone: number[] } {
  const asked = [...said(message)];
  const published = connections.map(publishedWords);
  return {
    any: published.map((own) => asked.filter((word) => own.has(word)).length),
    alone: published.map(
      (own, i) =>
        asked.filter(
          (word) =>
            own.has(word) &&
            published.every((other, j) => j === i || !other.has(word)),
        ).length,
    ),
  };
}
