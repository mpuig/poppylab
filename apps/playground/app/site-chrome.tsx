import { ArrowUpRight, createLucideIcon } from "lucide-react";
import {
  DEMOS_URL,
  LAB_AUTHOR,
  SPEC_URL,
  labFootGroups,
  LOCAL_ORIGINS,
  type LabFootGroup,
} from "@poppy-lab/pap-core";
import { SITE_NAME } from "@/lib/site";
import { BarNav } from "./bar-nav";
import { specLink } from "./spec-ref";

// Inlined at build time: local Companies in development, poppylab.dev when deployed.
const juniper = process.env.NEXT_PUBLIC_JUNIPER_URL ?? LOCAL_ORIGINS.juniper;
const lantern = process.env.NEXT_PUBLIC_LANTERN_URL ?? LOCAL_ORIGINS.lantern;
const harborline =
  process.env.NEXT_PUBLIC_HARBORLINE_URL ?? LOCAL_ORIGINS.harborline;
const northwind =
  process.env.NEXT_PUBLIC_NORTHWIND_URL ?? LOCAL_ORIGINS.northwind;
const fernwick = process.env.NEXT_PUBLIC_FERNWICK_URL ?? LOCAL_ORIGINS.fernwick;

// The footer's heart as Lucide drew it before 1.x (Lucide, ISC licence);
// Lucide 1.x reshaped its `Heart`.
const Heart = createLucideIcon("heart", [
  [
    "path",
    {
      d: "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z",
      key: "heart",
    },
  ],
]);

export { DEMOS_URL, SPEC_URL };

export const host = (url: string) => new URL(url).host;
export const connect = (url: string) =>
  `/playground?company=${encodeURIComponent(url)}`;

/**
 * The five fictional Companies. The home shows the plain-language fields and
 * `change`, the exact change the visitor would approve (from each Company's
 * own data), and `brand`, the leading colour of that Company's own website;
 * `/developers` adds the host, its own API's scopes and agent-facing page.
 * Each `ask` is one the keyless protocol demo runs (`DEMO_SUGGESTIONS` in
 * pap-agent's `demo-examples.ts`). Fernwick's plan change isn't one, so its
 * card asks for a read, and `approves` names what the visitor allows at
 * sign-in instead of a change.
 */
export const companies = [
  {
    id: "juniper",
    brand: "#17342b",
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
    scopes: "poppy:read · poppy:write",
    site: { label: "Visit the shop", href: juniper },
  },
  {
    id: "lantern",
    brand: "#c62f1e",
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
    scopes: "orders:read · orders:write",
    site: { label: "Visit the restaurant", href: lantern },
  },
  {
    id: "harborline",
    brand: "#073b5c",
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
    scopes:
      "accounts:read · transactions:read · cards:read · recipients:read · budgets:read · cards:write · transactions:write · budgets:write · payments:request · transfers:request",
    site: { label: "Visit the bank", href: harborline },
  },
  {
    id: "northwind",
    brand: "#1d6882",
    sector: "Airline",
    name: "Northwind Air",
    url: northwind,
    blurb:
      "An airline with flight search, trips, loyalty points, seats, bags and upgrades.",
    // No flight number, so it works for either test customer.
    ask: "Upgrade my flight to Business.",
    shows:
      "You see the exact upgrade price and approve it yourself. It is applied once.",
    change: [
      { what: "Flight NA 118", before: "Gale Flex", after: "Aurora Business" },
    ],
    scopes:
      "flights:search · bookings:read · profile:read · preferences:write · bookings:change",
    site: { label: "Visit the airline", href: northwind },
  },
  {
    id: "fernwick",
    brand: "#2c5a41",
    sector: "Utility",
    name: "Fernwick Power & Light",
    url: fernwick,
    blurb:
      "An electricity utility with hourly meter readings, monthly bills and two rate plans.",
    ask: "How much electricity did my EV use last week?",
    shows:
      "With “Use ESPI” on, the utility's energy-data extension, Iris reads a week of hourly readings from the meter you shared and adds them up. Nothing changes.",
    approves: "What you allow",
    change: [
      { what: "Meters shared", before: "", after: "EV charger only" },
      { what: "Access", before: "", after: "Read only" },
    ],
    scopes: "account:read · plan:write",
    site: { label: "Visit the utility", href: fernwick },
  },
] as const;

/**
 * Posts has a link only once there is a post to read. The count is the
 * build's (next.config.ts), so this file reads no files and the error
 * page can show the same header and footer in the browser.
 */
const hasPosts = () => Number(process.env.POPPY_POSTS ?? 0) > 0;

export function SiteBar({
  current,
}: {
  current?: "developers" | "learn" | "posts";
}) {
  return (
    <header className="bar">
      <a className="wordmark" href="/">
        {SITE_NAME}
      </a>
      <BarNav current={current} posts={hasPosts()} />
      <a className="button small" href="/playground">
        <span className="long">Try the live demo</span>
        <span className="short">Live demo</span>
      </a>
    </header>
  );
}

/**
 * The footer's groups: the ones every Company's footer shows too, with the
 * lab's own pages about itself (Posts, About and Privacy) added to its
 * group here, since they are this site's and not the Companies'.
 */
export function footGroups(posts = hasPosts()): LabFootGroup[] {
  const own = [
    ...(posts ? [{ label: "Posts", href: "/posts" }] : []),
    { label: "About", href: "/about" },
    { label: "Privacy", href: "/privacy" },
  ];
  return labFootGroups(juniper, "").map((group) =>
    group.id === "lab"
      ? {
          ...group,
          links: [
            ...group.links.filter((l) => !l.leaves),
            ...own,
            ...group.links.filter((l) => l.leaves),
          ],
        }
      : group,
  );
}

export function SiteFoot() {
  return (
    <footer className="foot">
      <div className="foot-about">
        <p className="wordmark">{SITE_NAME}</p>
        <p>
          An independent experiment with Personal Agent Protocol 1.0, following
          the text as published on 14 November 2026. Poppy Lab is not affiliated
          with or endorsed by the protocol&apos;s authors; “Personal Agent
          Protocol” and “Poppy” are their names. It makes no claim of
          conformance or production security.
        </p>
        <p className="foot-credit">
          With <Heart size={14} fill="currentColor" aria-hidden="true" />
          <span className="sr-only">love</span> by{" "}
          <a href={LAB_AUTHOR.url} rel="noopener">
            {LAB_AUTHOR.handle}
          </a>
        </p>
      </div>
      {/* The same groups the Companies' footers show; the lab's own links stay relative. */}
      {footGroups().map((group) => (
        <nav key={group.id} aria-labelledby={`foot-${group.id}`}>
          <p id={`foot-${group.id}`} className="foot-title">
            {group.title}
          </p>
          {group.links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              {...(link.newTab ? specLink : {})}
            >
              {link.label}
              {link.leaves && <ArrowUpRight size={14} aria-hidden="true" />}
            </a>
          ))}
        </nav>
      ))}
    </footer>
  );
}
