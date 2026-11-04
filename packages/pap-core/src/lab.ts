/**
 * The Poppy Lab sites, for the small "Part of Poppy Lab" line each site adds
 * to its own footer. Local development links to the localhost addresses.
 */
export type LabSite = "home" | "playground" | "juniper" | "lantern";
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
        : "https://juniper.poppylab.dev",
    },
    {
      id: "lantern" as const,
      label: "Lantern Noodle Bar",
      url: local
        ? "http://noodles.localhost:4200"
        : "https://noodles.poppylab.dev",
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
  return `<p class="${className}">Part of <a href="${escape(home.url)}">Poppy&nbsp;Lab</a>, an independent PAP 0.3 test bench · ${items.join(" · ")} · <a href="${LAB_REPOSITORY}">${nbsp("Source on GitHub")}</a></p>`;
}
