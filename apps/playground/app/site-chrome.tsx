import { ArrowUpRight } from "lucide-react";
import { LAB_REPOSITORY, labSites } from "@poppy-lab/pap-core";

// Inlined at build time: local Companies in development, poppylab.dev when deployed.
const juniper =
  process.env.NEXT_PUBLIC_JUNIPER_URL ?? "http://juniper.localhost:4100";
const lantern =
  process.env.NEXT_PUBLIC_LANTERN_URL ?? "http://noodles.localhost:4200";
const harborline =
  process.env.NEXT_PUBLIC_HARBORLINE_URL ?? "http://harbor.localhost:4300";
const northwind =
  process.env.NEXT_PUBLIC_NORTHWIND_URL ?? "http://northwind.localhost:4400";

export const SPEC_URL = "https://personalagentprotocol.org/docs/1.0/spec";
export const DEMOS_URL = "https://personalagentprotocol.org/docs/demos";

export const host = (url: string) => new URL(url).host;
export const connect = (url: string) =>
  `/playground?company=${encodeURIComponent(url)}`;

/**
 * The four fictional Companies. The home shows the plain-language fields and
 * `change`, the exact change the visitor would approve (from each Company's
 * own data); `/developers` adds the host, scopes and agent-facing page.
 */
export const companies = [
  {
    id: "juniper",
    sector: "Grocery",
    name: "Juniper Market",
    url: juniper,
    blurb:
      "A neighbourhood grocery with a basket, a weekly delivery, orders and support cases.",
    ask: "Move my recurring delivery to Saturday.",
    shows:
      "You see the day before and after, then approve. The shop's website updates within seconds.",
    change: [
      { what: "Recurring delivery", before: "Thursday", after: "Saturday" },
    ],
    people: "Elena or Robin",
    scopes: "poppy:read · poppy:write",
    site: { label: "Visit the shop", href: juniper },
    agents: { label: "For agents", path: "/for-agents" },
  },
  {
    id: "lantern",
    sector: "Restaurant",
    name: "Lantern Noodle Bar",
    url: lantern,
    blurb: "A noodle bar with a menu, delivery slots and scheduled orders.",
    ask: "Add a matcha ice cream and move it to Sunday lunchtime.",
    shows:
      "The approval shows the new dishes, the new slot and the price difference before anything changes.",
    change: [
      { what: "Order", before: "", after: "+ 1 Matcha ice cream" },
      { what: "Delivery slot", before: "", after: "Sunday 13:00–13:30" },
    ],
    people: "Elena or Robin",
    scopes: "orders:read · orders:write",
    site: { label: "Visit the restaurant", href: lantern },
    agents: { label: "For agents", path: "/for-agents" },
  },
  {
    id: "harborline",
    sector: "Bank",
    name: "Harborline Bank",
    url: harborline,
    blurb:
      "A bank with accounts, transactions, cards, saved recipients and budgets.",
    ask: "Transfer $500 from checking to savings.",
    shows:
      "Money moves only on your approval, and the bank rechecks balance and limits at that moment.",
    change: [
      { what: "Operating checking", before: "", after: "− $500.00" },
      { what: "Reserve savings", before: "", after: "+ $500.00" },
    ],
    people: "Elena or Robin",
    scopes: "Reads · reversible changes · payment requests",
    site: { label: "Visit the bank", href: harborline },
    agents: { label: "For agents", path: "/for-agents" },
  },
  {
    id: "northwind",
    sector: "Airline",
    name: "Northwind Air",
    url: northwind,
    blurb:
      "An airline with flight search, trips, loyalty points, seats, bags and upgrades.",
    ask: "Upgrade my NA 118 flight to Business.",
    shows:
      "You see the exact upgrade price and approve it yourself. It is applied once.",
    change: [
      { what: "Flight NA 118", before: "Gale Flex", after: "Aurora Business" },
    ],
    people: "Elena or Robin",
    scopes: "bookings:read · bookings:change",
    site: { label: "Visit the airline", href: northwind },
    agents: { label: "For agents", path: "/for-agents" },
  },
] as const;

export function SiteBar({ current }: { current?: "developers" | "learn" }) {
  return (
    <header className="bar">
      <a className="wordmark" href="/">
        Poppy Lab
      </a>
      <nav aria-label="Sections">
        <a href="/#why">Why it exists</a>
        <a href="/#how">How it works</a>
        <a href="/#who">Who it&apos;s for</a>
        <a href="/#try">Try it</a>
        <a
          href="/learn"
          aria-current={current === "learn" ? "page" : undefined}
        >
          Learn
        </a>
        <a
          href="/developers"
          aria-current={current === "developers" ? "page" : undefined}
        >
          Developers
        </a>
      </nav>
      <a className="button small" href="/playground">
        <span className="long">Try the live demo</span>
        <span className="short">Live demo</span>
      </a>
    </header>
  );
}

export function SiteFoot() {
  return (
    <footer className="foot">
      <div>
        <p className="wordmark">Poppy Lab</p>
        <p>
          An independent experiment with Personal Agent Protocol 1.0, following
          the text as published on 14 November 2026. Poppy Lab makes no claim of
          conformance or production security.
        </p>
      </div>
      <nav aria-label="Poppy Lab sites" className="lab-nav">
        {labSites(juniper)
          .filter((s) => s.id !== "home")
          .map((s) => (
            <a key={s.id} href={s.url}>
              {s.label}
            </a>
          ))}
        <a href="/learn">Learn</a>
        <a href="/developers">Developers</a>
        <a href={LAB_REPOSITORY}>
          Source on GitHub <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </nav>
      <nav aria-label="Elsewhere">
        <a href={SPEC_URL}>
          Specification <ArrowUpRight size={14} aria-hidden="true" />
        </a>
        <a href={DEMOS_URL}>
          Community demos <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </nav>
      <p className="disclaimer">
        Not affiliated with or endorsed by the protocol&apos;s authors.
        “Personal Agent Protocol” and “Poppy” are their names.
      </p>
    </footer>
  );
}
