import {
  consentSheetCss,
  consentSheetHtml,
  labConsentBarHtml,
} from "@poppy-lab/pap-core";
import { personas } from "./personas.js";

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** Juniper's paper, green and serif on the sheet every Company's consent shares. */
const css = `
:root{color-scheme:light;--paper:#f5f3eb;--ink:#17342b;--muted:#496653;--line:#c6cebf;--focus:#9b472e;--field:#fdfcf8}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,sans-serif}header{padding:20px clamp(20px,5vw,70px);border-bottom:1px solid var(--line)}.brand{font-weight:800;font-size:20px;letter-spacing:-.03em}:focus-visible{outline:2px solid var(--focus);outline-offset:4px}::selection{background:#c8d8bf;color:var(--ink)}input{caret-color:var(--ink)}
${consentSheetCss}.sheet{--sheet-rule:var(--line);--sheet-accent:var(--ink)}
.sheet h1{font:400 clamp(32px,4.6vw,48px)/1.08 Georgia,serif;letter-spacing:-.025em}
.sheet-agent{color:var(--muted)}.sheet-agent strong{color:var(--ink)}
.sheet-verified{font-size:13px;font-weight:600;line-height:1;padding:5px 9px;border-radius:999px;background:#dce8d2;color:#24513a}
.sheet legend,.sheet h2{font:400 24px/1.2 Georgia,serif}
.sheet-person{border-radius:5px;background:var(--field)}
.sheet-person small{font-size:14px}
.sheet-person small,.sheet-note,.sheet-reads span,.sheet-option span span,.sheet-none,.sheet-foot p,.sheet-fine{color:var(--muted)}
.sheet-group h3{font-size:16px;font-weight:650}
.sheet-group h3 span{font-weight:400;font-size:14px;color:var(--muted)}
.sheet-option strong{font-weight:650}.sheet-option span span{font-size:15px}
.sheet-field label{font-weight:600}
.sheet-field input{border:1px solid var(--muted);border-radius:5px;background:var(--field);color:var(--ink)}
.sheet button{font:600 16px/1.3 ui-sans-serif,system-ui,sans-serif;border:1px solid var(--ink);border-radius:5px;background:var(--ink);color:var(--paper)}
.sheet button:hover{background:#2b5140}.sheet button:active{background:#10261e}
.sheet button.secondary{background:transparent;color:var(--ink);border-color:var(--line)}
.sheet button.secondary:hover{background:#e9eddf}.sheet button.secondary:active{background:#dce4d2}
.sheet-foot p{font-size:15px}.sheet-fine{font-size:13px}
`;
/** Server-rendered consent: no scripts, remote assets or credential values. */
export function consentPage(
  nonce: string,
  passwordRequired: boolean,
  scopes = "poppy:read poppy:write",
  client = "Iris",
  clientHost = "poppylab.dev",
) {
  const read = scopes.split(" ").includes("poppy:read"),
    write = scopes.split(" ").includes("poppy:write");
  const sheet = consentSheetHtml({
    company: "Juniper",
    agent: client,
    agentHost: clientHost,
    nonce,
    passwordRequired,
    people: personas.map((person) => ({
      id: person.id,
      name: person.name,
      note: `Recurring delivery on ${person.day}`,
    })),
    reads: read
      ? [
          { text: "Basket, orders and recurring deliveries." },
          { text: "Profile, address and simulated billing documents." },
          { text: "Support cases and their messages." },
        ]
      : [],
    noReads: "No permission to read your account is requested.",
    changes: write
      ? [
          {
            name: "write",
            title: "Basket, purchases, deliveries, profile and support cases",
            text: `This doesn't confirm any purchase. ${read ? "Untick it to give read-only access." : "It does not include read access."}`,
            checked: true,
            required: !read,
          },
        ]
      : [],
    noChanges:
      "None. If you want a change later, your agent will ask you again.",
    disconnect:
      "You can take the permission away under Connected agents in your Juniper account.",
    fine: "Juniper Market is a fictional shop. Nothing is charged or shipped.",
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Allow ${escapeHtml(client)} · Juniper Market</title><style>${css}</style></head><body>${labConsentBarHtml("Juniper Market")}<header><span class="brand">Juniper Market</span></header>${sheet}</body></html>`;
}
