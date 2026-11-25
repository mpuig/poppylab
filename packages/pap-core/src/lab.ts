/**
 * What the fictional Companies share: a strip at the top of every page that
 * says the site is a demo, and the "Part of Poppy Lab" line in each footer.
 * Everything else on a Company's site speaks in that Company's own voice.
 * Local development links to the localhost addresses.
 */
export type LabSite =
  "home" | "playground" | "juniper" | "lantern" | "harborline" | "northwind";
export const LAB_REPOSITORY = "https://github.com/mpuig/poppylab";

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
      url: local
        ? "http://juniper.localhost:4100"
        : "https://grocery-demo.poppylab.dev",
    },
    {
      id: "lantern" as const,
      label: "Lantern Noodle Bar",
      url: local
        ? "http://noodles.localhost:4200"
        : "https://food-demo.poppylab.dev",
    },
    {
      id: "harborline" as const,
      label: "Harborline Bank",
      url: local
        ? "http://harbor.localhost:4300"
        : "https://bank-demo.poppylab.dev",
    },
    {
      id: "northwind" as const,
      label: "Northwind Air",
      url: local
        ? "http://northwind.localhost:4400"
        : "https://airline-demo.poppylab.dev",
    },
  ];
}

const escape = (t: string) =>
  t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** Keeps each name on one line; the line breaks between the names. */
const nbsp = (t: string) => escape(t).replace(/ /g, "&nbsp;");
/** The line as HTML for the server-rendered Companies; the current site is plain text. */
export function labLineHtml(
  origin: string,
  current: LabSite,
  className = "lab",
) {
  const items = labSites(origin)
    .filter((s) => s.id !== "home")
    .map((s) =>
      s.id === current
        ? `<span aria-current="page">${nbsp(s.label)}</span>`
        : `<a href="${escape(s.url)}">${nbsp(s.label)}</a>`,
    );
  const home = labSites(origin)[0]!;
  return `<p class="${className}">Part of <a href="${escape(home.url)}">Poppy&nbsp;Lab</a>, an independent demo of Personal Agent Protocol · ${items.join(" · ")} · <a href="${LAB_REPOSITORY}">${nbsp("Source on GitHub")}</a></p>`;
}

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
