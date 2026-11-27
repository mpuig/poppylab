/**
 * What the fictional Companies share: a strip at the top of every page that
 * says the site is a demo, and a footer built like the lab's own (what the
 * site is, then the same three groups of links). Everything else on a
 * Company's site speaks in that Company's own voice. Local development links
 * to the localhost addresses.
 */
import { SPEC_URL } from "./spec-links.ts";

export type LabSite =
  | "home"
  | "playground"
  | "juniper"
  | "lantern"
  | "harborline"
  | "northwind"
  | "fernwick";
export const LAB_REPOSITORY = "https://github.com/mpuig/poppylab";
/** Other people's demos of the protocol, as its authors list them. */
export const DEMOS_URL = "https://personalagentprotocol.org/docs/demos";
/** Who signs every footer: "With ♥ by @mpuig". */
export const LAB_AUTHOR = {
  handle: "@mpuig",
  url: "https://x.com/mpuig",
} as const;

/**
 * The lab's sites. Each Company also lists a few plain words (`words`) a
 * person may use for it instead of its name, such as "the bank": Iris
 * matches what they type in the chat against these and the names here,
 * and never against anything else. No two Companies share a word.
 *
 * Each word says what kind of company it is, never what it sells: "remove
 * the noodles" and "add flights" are what a person says to a Company
 * about an order, and Iris reads these words as a command only after
 * "connect with", "connect to" and "disconnect from". Elsewhere they only
 * tell which Company a request is for, when no model says ("my bank
 * account").
 */
export function labSites(origin: string) {
  const local = /(^|\.)localhost$/.test(new URL(origin).hostname);
  return [
    {
      id: "home" as const,
      label: "Poppy Lab",
      url: local ? "http://localhost:3000" : "https://poppylab.dev",
    },
    {
      id: "playground" as const,
      label: "Playground",
      url: local
        ? "http://localhost:3000/playground"
        : "https://poppylab.dev/playground",
    },
    {
      id: "juniper" as const,
      label: "Juniper Market",
      words: ["grocery store", "supermarket"],
      url: local
        ? "http://juniper.localhost:4100"
        : "https://grocery-demo.poppylab.dev",
    },
    {
      id: "lantern" as const,
      label: "Lantern Noodle Bar",
      words: ["restaurant", "noodle bar"],
      url: local
        ? "http://noodles.localhost:4200"
        : "https://food-demo.poppylab.dev",
    },
    {
      id: "harborline" as const,
      label: "Harborline Bank",
      words: ["bank"],
      url: local
        ? "http://harbor.localhost:4300"
        : "https://bank-demo.poppylab.dev",
    },
    {
      id: "northwind" as const,
      label: "Northwind Air",
      words: ["airline"],
      url: local
        ? "http://northwind.localhost:4400"
        : "https://airline-demo.poppylab.dev",
    },
    {
      id: "fernwick" as const,
      label: "Fernwick Power & Light",
      words: ["utility", "power company", "energy company"],
      url: local
        ? "http://fernwick.localhost:4500"
        : "https://energy-demo.poppylab.dev",
    },
  ];
}

const escape = (t: string) =>
  t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export type LabFootLink = {
  label: string;
  href: string;
  /** The lab site it leads to, so a footer can mark the one it stands on. */
  site?: LabSite;
  /** Leaves the lab, so it carries the up-right arrow. */
  leaves?: true;
  /** Opens in a new tab, as every link into the protocol's own pages does. */
  newTab?: true;
};
export type LabFootGroup = {
  id: "lab" | "demos" | "protocol";
  title: string;
  links: LabFootLink[];
};

/**
 * The three groups of links in every footer, written once: the lab's own
 * footer (`SiteFoot` in the playground) and the Companies' (`labFootHtml`)
 * both read this list. `lab` is where the lab's pages are: its address, or
 * "" on the lab's own pages, whose links stay relative.
 */
export function labFootGroups(
  origin: string,
  lab: string = labSites(origin)[0]!.url,
): LabFootGroup[] {
  return [
    {
      id: "lab",
      title: "Poppy Lab",
      links: [
        { label: "Playground", href: `${lab}/playground`, site: "playground" },
        { label: "Learn", href: `${lab}/learn` },
        { label: "Developers", href: `${lab}/developers` },
        { label: "Source on GitHub", href: LAB_REPOSITORY, leaves: true },
      ],
    },
    {
      id: "demos",
      title: "Demos",
      links: labSites(origin)
        .filter((s) => s.id !== "home" && s.id !== "playground")
        .map((s) => ({ label: s.label, href: s.url, site: s.id })),
    },
    {
      id: "protocol",
      title: "Protocol",
      links: [
        { label: "Specification", href: SPEC_URL, leaves: true, newTab: true },
        {
          label: "Community demos",
          href: DEMOS_URL,
          leaves: true,
          newTab: true,
        },
      ],
    },
  ];
}

/** What a Company says about itself at the head of its footer. */
export type LabFootAbout = {
  /** The Company's name, set as its wordmark. */
  name: string;
  /** Trusted HTML, a paragraph each: the notice that it is fictional, in its own words. */
  notice: readonly string[];
  /** Who else it has nothing to do with: "any real bank". */
  unaffiliated?: readonly string[];
};

// Drawn here, so the footer needs no icon library and fetches nothing.
const icon = (drawing: string) =>
  `<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" ${drawing}</svg>`;
const heart = icon(
  'fill="currentColor"><path d="M12 21 3.5 12.5a5 5 0 0 1 7.1-7.1L12 6.8l1.4-1.4a5 5 0 0 1 7.1 7.1Z"/>',
);
const arrow = icon(
  'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9"/>',
);

/**
 * A Company's footer, in the order of the lab's own: the Company's name, its
 * notice that it is fictional, the sentence on independence and the
 * signature, then the three groups of links. The site the visitor is on is
 * text, not a link, and "Playground" opens with this Company's address
 * filled in. No script, so it works under each site's
 * Content-Security-Policy. `labFootCss` lays it out.
 */
export function labFootHtml(
  origin: string,
  current: LabSite,
  about: LabFootAbout,
) {
  const home = labSites(origin)[0]!.url;
  const authors = "the authors of the Personal Agent Protocol";
  const others = about.unaffiliated ?? [];
  const endorsedBy = others.length
    ? `${others.join(", by ")} or by ${authors}`
    : authors;
  const link = (l: LabFootLink) => {
    if (l.site === current)
      return `<span aria-current="page">${escape(l.label)}</span>`;
    const href = l.site === "playground" ? labPlaygroundUrl(origin) : l.href;
    return `<a href="${escape(href)}"${l.newTab ? ' target="_blank" rel="noopener noreferrer"' : ""}>${escape(l.label)}${l.leaves ? arrow : ""}</a>`;
  };
  const groups = labFootGroups(origin).map(
    (g) =>
      `<nav aria-labelledby="foot-${g.id}"><p id="foot-${g.id}" class="lab-foot-title">${escape(g.title)}</p>${g.links.map(link).join("")}</nav>`,
  );
  return `<div class="lab-foot"><div class="lab-foot-about"><p class="lab-foot-name">${escape(about.name)}</p>${about.notice.map((p) => `<p>${p}</p>`).join("")}<p>Part of <a href="${escape(home)}">Poppy&nbsp;Lab</a>, an independent experiment that is not affiliated with or endorsed by ${escape(endorsedBy)}. “Personal Agent Protocol” and “Poppy” are their names.</p><p class="lab-foot-credit">With ${heart}<span class="lab-foot-sr">love</span> by <a href="${LAB_AUTHOR.url}" rel="noopener">${LAB_AUTHOR.handle}</a></p></div>${groups.join("")}</div>`;
}

/**
 * The footer's layout and text sizes, which are the lab's own (`.foot` in
 * the playground's `site.css`): the about block beside three groups, three
 * columns under it at 960px and below, two at 520px and below. A Company
 * adds its ground and its wordmark's face (`.lab-foot-name`), and sets four
 * colours: `--foot-ink` (the name, the titles, the current site, a link
 * under the pointer), `--foot-soft` (sentences and links), `--foot-muted`
 * (the signature) and `--foot-rule` (the underline of a link in a sentence).
 */
export const labFootCss = `.lab-foot{display:grid;grid-template-columns:minmax(0,5fr) repeat(3,minmax(0,2fr));gap:40px clamp(24px,4vw,56px);align-items:start;font-size:15px;line-height:1.6;color:var(--foot-soft)}
.lab-foot p{margin:0}
.lab-foot .lab-foot-name,.lab-foot .lab-foot-title,.lab-foot [aria-current]{color:var(--foot-ink)}
.lab-foot-about p+p{margin-top:10px;max-width:46ch;line-height:1.55}
.lab-foot-about a{color:inherit;text-decoration:underline;text-decoration-thickness:1px;text-decoration-color:var(--foot-rule);text-underline-offset:3px}
.lab-foot-about a:hover{color:var(--foot-ink);text-decoration-color:currentColor}
.lab-foot-about .lab-foot-credit{display:flex;align-items:center;gap:5px;margin-top:18px;font-size:14px;line-height:1.5;color:var(--foot-muted)}
.lab-foot-credit a{color:var(--foot-soft)}
.lab-foot svg{flex:none}
.lab-foot-sr{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.lab-foot nav{display:grid;gap:10px;justify-items:start;margin:0}
.lab-foot .lab-foot-title{margin-bottom:4px;font-size:14px;font-weight:600}
.lab-foot nav a{display:inline-flex;align-items:center;gap:4px;color:inherit;text-decoration:none}
.lab-foot nav a:hover{color:var(--foot-ink);text-decoration:underline}
.lab-foot [aria-current]{font-weight:600}
@media(max-width:960px){.lab-foot{grid-template-columns:repeat(3,minmax(0,1fr))}.lab-foot-about{grid-column:1/-1}}
@media(max-width:520px){.lab-foot{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;

/** The playground with this Company's address already filled in. */
export function labPlaygroundUrl(origin: string) {
  const playground = labSites(origin)[1]!.url;
  return `${playground}?company=${encodeURIComponent(origin)}`;
}

/**
 * The strip above a fictional Company's own header. It carries its own
 * inline styles and a system font, so it looks the same on every site and
 * never borrows the Company's identity. Its colours are Poppy Lab's own:
 * graphite ink, with the lab's amber on the word "Demo". No script, so it works under each
 * site's Content-Security-Policy.
 */
export function labBarHtml(origin: string, company: string) {
  const home = labSites(origin)[0]!.url;
  const link = "color:#fff;text-underline-offset:3px;white-space:nowrap";
  return `<aside aria-label="About this demo" style="display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:4px 20px;margin:0;padding:8px 16px;background:#171a1f;color:#e3e6ea;font:400 13px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif;text-align:center;letter-spacing:0;text-transform:none"><span><strong style="color:#f2b705;font-weight:600">Demo</strong> · ${escape(company)} is a fictional company in Poppy&nbsp;Lab. Nothing here is real.</span><span style="display:inline-flex;flex-wrap:wrap;justify-content:center;gap:4px 20px"><a href="${escape(labPlaygroundUrl(origin))}" style="${link};font-weight:600">Try it with an AI agent</a><a href="${escape(home)}" style="${link}">What is this?</a></span></aside>`;
}
