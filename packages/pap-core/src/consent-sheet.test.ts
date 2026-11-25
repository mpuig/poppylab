import { describe, expect, it } from "vitest";
import { consentSheetHtml, labConsentBarHtml } from "./consent-sheet.ts";

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

  it("has a demo strip without links, so nothing leads away from the decision", () => {
    const bar = labConsentBarHtml("Shop & Co");
    expect(bar).toContain("Shop &#38; Co is a fictional company");
    expect(bar).not.toContain("<a ");
  });
});
