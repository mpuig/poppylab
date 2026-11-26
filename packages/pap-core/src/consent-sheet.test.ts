import { describe, expect, it } from "vitest";
import {
  BROWSER_SIGN_IN,
  browserAccess,
  browserSignInHint,
  browserSignInScope,
  consentExpiredHtml,
  consentSheetCss,
  consentSheetHtml,
  consentWords,
  labConsentBarHtml,
} from "./consent-sheet.ts";

const sheet = {
  company: "Shop",
  agent: "Iris",
  agentHost: "poppylab.dev",
  nonce: "n1",
  passwordRequired: false,
  people: [
    { id: "elena", name: "Elena Maren", note: "Order for Friday" },
    { id: "robin", name: "Robin Ito", note: "Order for Saturday" },
  ],
  reads: [{ title: "Your orders", text: "Dishes and price." }],
  changes: [
    {
      name: "write",
      title: "Your orders",
      text: "Move the slot.",
      checked: true,
    },
  ],
  disconnect: "You can take the permission away under Your account.",
  fine: "Shop is fictional.",
};

describe("the consent sheet the Companies share", () => {
  it("posts the fields the gateway reads, with the first person chosen", () => {
    const html = consentSheetHtml(sheet);
    expect(html).toContain('<form method="post" action="/oauth/authorize">');
    expect(html).toContain('<input type="hidden" name="nonce" value="n1">');
    expect(html).toContain(
      '<input type="radio" name="account" id="account-elena" value="elena" checked>',
    );
    expect(html).toContain(
      '<input type="radio" name="account" id="account-robin" value="robin">',
    );
    expect(html.match(/type="radio"[^>]* checked/g)).toHaveLength(1);
    expect(html).toContain(
      '<input type="checkbox" name="write" value="yes" checked>',
    );
    expect(html).toContain(
      '<button class="secondary" name="decision" value="decline" formnovalidate>Don&#39;t allow</button><button name="decision" value="approve">Allow</button>',
    );
    expect(html).not.toContain('type="password"');
  });

  it("says the same words at every Company", () => {
    const html = consentSheetHtml(sheet);
    for (const words of [
      "<h1>Iris wants to connect to your Shop account</h1>",
      "<legend>Sign in as</legend>",
      "Test customers. Choosing one doesn&#39;t verify who you are.",
      "What Iris may do",
      "<h3>Read <span>without asking you again</span></h3>",
      "<h3>Propose changes <span>each one waits for your approval</span></h3>",
      "Nothing changes when you allow. You can take the permission away under Your account.",
    ])
      expect(html).toContain(words);
    expect(consentSheetHtml({ ...sheet, personKind: "passenger" })).toContain(
      "Test passengers.",
    );
  });

  it("opens on the person named, and on the first when nobody or a stranger is named", () => {
    const robin = consentSheetHtml({ ...sheet, chosen: "robin" });
    expect(robin).toContain(
      '<input type="radio" name="account" id="account-robin" value="robin" checked>',
    );
    expect(robin).toContain(
      '<input type="radio" name="account" id="account-elena" value="elena">',
    );
    expect(robin.match(/type="radio"[^>]* checked/g)).toHaveLength(1);
    for (const chosen of [undefined, "nobody"]) {
      const first = consentSheetHtml({ ...sheet, chosen });
      expect(first).toContain('id="account-elena" value="elena" checked>');
      expect(first.match(/type="radio"[^>]* checked/g)).toHaveLength(1);
    }
  });

  it("says so when nothing is read, nothing can be proposed, or a password is needed", () => {
    const html = consentSheetHtml({
      ...sheet,
      reads: [],
      changes: [],
      passwordRequired: true,
    });
    expect(html).toContain(
      '<p class="sheet-none">Nothing of yours is read.</p>',
    );
    expect(html).toContain(
      '<p class="sheet-none">None. This permission is read only.</p>',
    );
    expect(html).toContain(
      '<input id="password" type="password" name="password" required autocomplete="current-password" maxlength="256"',
    );
    expect(
      consentSheetHtml({ ...sheet, reads: [], noReads: "No read asked." }),
    ).toContain("No read asked.");
  });

  it("marks what can't be unticked, and puts further choices under their own heading", () => {
    const html = consentSheetHtml({
      ...sheet,
      changes: [{ ...sheet.changes[0]!, required: true }],
      extras: [
        {
          heading: "While you're away",
          option: {
            name: "allow_offline",
            title: "Stay connected",
            text: "Optional.",
          },
        },
      ],
    });
    expect(html).toContain('name="write" value="yes" checked required>');
    expect(html).toContain(
      '<div class="sheet-group"><h3>While you&#39;re away</h3><label class="sheet-option"><input type="checkbox" name="allow_offline" value="yes">',
    );
  });

  it("escapes what the agent and the Company say, and trusts only what sits beside the people", () => {
    const html = consentSheetHtml({
      ...sheet,
      agent: "<b>Iris</b>",
      agentHost: 'x"y',
      nonce: '"><script>',
      beside: '<div class="accounts">chosen</div>',
    });
    expect(html).not.toContain("<b>Iris");
    expect(html).not.toContain("<script");
    expect(html).toContain("&#60;b&#62;Iris&#60;/b&#62; wants to connect");
    expect(html).toContain("from x&#34;y");
    expect(html).toContain('<div class="accounts">chosen</div></fieldset>');
  });

  it("says what a permission allows in the sheet's words, for a website's list of connected agents", () => {
    expect(consentWords(sheet)).toEqual([
      "Read: Your orders.",
      "Propose changes: Your orders.",
    ]);
    // A part without a title goes by its text; nothing asked, no line.
    expect(
      consentWords({
        reads: [{ text: "Basket and orders." }, { text: "Support cases." }],
        changes: [],
        extras: [
          {
            heading: "While you're away",
            option: { name: "o", title: "Keep the agent connected", text: "" },
          },
        ],
      }),
    ).toEqual([
      "Read: Basket and orders; Support cases.",
      "While you're away: Keep the agent connected.",
    ]);
  });

  it("gives the agent's browser its own line, ticked, that the customer can untick", () => {
    // Not asked for, no line.
    expect(browserAccess("orders:read orders:write")).toEqual({});
    const asked = browserAccess(`orders:read ${BROWSER_SIGN_IN}`);
    expect(asked).toEqual({
      extras: [
        {
          heading: "On this website",
          option: {
            name: "allow_browser",
            title: "Browse signed in, read only",
            text: "The agent's own browser may open this website signed in to your account. It sees what the read permissions above cover, and can't change anything here.",
            checked: true,
            required: false,
          },
        },
      ],
    });
    const html = consentSheetHtml({ ...sheet, ...asked });
    expect(html).toContain(
      '<div class="sheet-group"><h3>On this website</h3><label class="sheet-option"><input type="checkbox" name="allow_browser" value="yes" checked><span><strong>Browse signed in, read only</strong>',
    );
    // The same words under Connected agents.
    expect(consentWords({ ...sheet, ...asked })).toEqual([
      "Read: Your orders.",
      "Propose changes: Your orders.",
      "On this website: Browse signed in, read only.",
    ]);
    // All that was asked for: allowing means allowing it.
    expect(browserAccess(BROWSER_SIGN_IN).extras![0]!.option.required).toBe(
      true,
    );
    // It goes after a Company's own further choices.
    const own = {
      heading: "While you're away",
      option: { name: "o", title: "Keep the agent connected", text: "" },
    };
    expect(
      browserAccess(`a ${BROWSER_SIGN_IN}`, [own]).extras!.map(
        (extra) => extra.heading,
      ),
    ).toEqual(["While you're away", "On this website"]);
    expect(browserAccess("a", [own])).toEqual({ extras: [own] });
  });

  it("describes the scope the same way for every Company's poppy.json", () => {
    expect(browserSignInScope("Shop")).toEqual({
      "poppy:browser-sign-in":
        "Open Shop's website in the agent's own browser, signed in to your account. The website shows what the read permissions you grant cover, and nothing can be changed there. Not needed for the API or for Shop's own agent.",
    });
    expect(browserSignInHint).toEqual({
      "poppy:browser-sign-in": { changes: "none", personal_data: true },
    });
  });

  it("says in the sheet's place that the page ran out, that nothing was allowed and what to do", () => {
    const html = consentExpiredHtml("Shop & Co");
    expect(html).toBe(
      '<main class="sheet"><div class="sheet-head"><h1>This page has expired</h1></div><div class="sheet-expired"><p>A page that asks whether an agent may connect to your Shop &#38; Co account works for five minutes after it opens, and this one is older. Your answer arrived too late, so nothing was allowed and nothing has changed.</p><p>To connect the agent, go back to it and start the sign-in again.</p></div></main>',
    );
    // Nothing to answer and nothing that leads anywhere.
    expect(html).not.toMatch(/<form|<a |<input|<button/);
    expect(consentSheetCss).toContain(".sheet-expired");
  });

  it("has a demo strip without links, so nothing leads away from the decision", () => {
    const bar = labConsentBarHtml("Shop & Co");
    expect(bar).toContain("Shop &#38; Co is a fictional company");
    expect(bar).not.toContain("<a ");
  });
});
