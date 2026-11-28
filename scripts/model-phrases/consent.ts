/**
 * A browser at one Company, as far as signing in needs: its cookies, and
 * its consent page answered with Allow for the test customer it opens on,
 * as the page left it (the same way as `scripts/smoke/production.ts`).
 * Codes, cookies and `state` stay here and are never printed: an error
 * names a URL without its query.
 */

/** A URL as an error may show it: without its query. */
export const shown = (url: string) => {
  try {
    const { origin, pathname } = new URL(url);
    return origin + pathname;
  } catch {
    return "an address that isn't a URL";
  }
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};
const decoded = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) =>
    e[0] !== "#"
      ? (ENTITIES[e.toLowerCase()] ?? all)
      : String.fromCodePoint(
          e[1] === "x" || e[1] === "X"
            ? parseInt(e.slice(2), 16)
            : Number(e.slice(1)),
        ),
  );

const attributesOf = (tag: string) =>
  new Map(
    [...tag.matchAll(/([a-z][a-z0-9_-]*)(?:="([^"]*)")?/gi)]
      .slice(1)
      .map(([, name, value]) => [name!.toLowerCase(), decoded(value ?? "")]),
  );

/** What a browser posts for the form that posts to `action`, as the page left it. */
function formFields(html: string, action: string) {
  const form = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].find(
    ([, tag]) => attributesOf(`<form${tag}`).get("action") === action,
  )?.[2];
  if (form === undefined) return undefined;
  const fields = new URLSearchParams();
  for (const [tag] of form.matchAll(/<input\b[^>]*>/gi)) {
    const a = attributesOf(tag);
    const name = a.get("name");
    const type = a.get("type") ?? "text";
    const ticks = type === "checkbox" || type === "radio";
    if (!name || ["submit", "button", "image", "reset", "file"].includes(type))
      continue;
    if (ticks && !a.has("checked")) continue;
    fields.append(name, a.get("value") ?? (ticks ? "on" : ""));
  }
  for (const [, tag, body] of form.matchAll(
    /<select\b([^>]*)>([\s\S]*?)<\/select>/gi,
  )) {
    const name = attributesOf(`<select${tag}`).get("name");
    const options = [...body!.matchAll(/<option\b[^>]*>/gi)].map(([o]) =>
      attributesOf(o),
    );
    const chosen = options.find((o) => o.has("selected")) ?? options[0];
    if (name && chosen) fields.append(name, chosen.get("value") ?? "");
  }
  return fields;
}

export class CompanyBrowser {
  private cookies = new Map<string, string>();
  constructor(readonly origin: string) {}

  private header(): Record<string, string> {
    return this.cookies.size
      ? {
          cookie: [...this.cookies].map(([n, v]) => `${n}=${v}`).join("; "),
        }
      : {};
  }

  private keep(response: Response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = line.split(";");
      const at = pair.indexOf("=");
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      if (!name) continue;
      if (!value || attributes.some((a) => /^\s*max-age=0\s*$/i.test(a)))
        this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  /**
   * Answers the consent page at `url` with Allow, and returns where the
   * Company sends the browser back: the agent's callback, with its code.
   */
  async allow(url: string) {
    const page = await fetch(url, {
      headers: { accept: "text/html", ...this.header() },
      redirect: "manual",
    });
    this.keep(page);
    if (page.status !== 200)
      throw new Error(`The consent page ${shown(url)} answered ${page.status}`);
    const fields = formFields(await page.text(), "/oauth/authorize");
    if (!fields?.get("nonce"))
      throw new Error(`${shown(url)} has no consent form`);
    fields.set("decision", "approve");
    const allowed = await fetch(new URL("/oauth/authorize", this.origin), {
      method: "POST",
      headers: {
        origin: this.origin,
        accept: "text/html",
        "content-type": "application/x-www-form-urlencoded",
        ...this.header(),
      },
      body: fields.toString(),
      redirect: "manual",
    });
    this.keep(allowed);
    await allowed.body?.cancel();
    const location = allowed.headers.get("location");
    if (allowed.status !== 302 || !location)
      throw new Error(`Allow at ${this.origin} answered ${allowed.status}`);
    const back = new URL(location, this.origin);
    if (back.searchParams.has("error"))
      throw new Error(
        `${this.origin} answered Allow with ${back.searchParams.get("error")?.slice(0, 40)}`,
      );
    return back;
  }
}
