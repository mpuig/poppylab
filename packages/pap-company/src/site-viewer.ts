/**
 * Who a Company's website serves on a request, once a browser can be
 * joined to an agent's Session (§6). A browser joined with an access token
 * is signed in to the token's account, whatever login cookie it sends, and
 * the website shows it what the token's scopes cover, as the Company's API
 * would, and nothing that is the customer's own to see: the connected
 * agents, what they asked for, what they reported. Any other browser is
 * served by its own website login. A joined browser changes nothing: the
 * gateway refuses its changes, and the website renders no control for one.
 * The words a website says about it are the same at every Company.
 */
import type { BrowserJoin } from "./gateway/types.ts";

export type SiteViewer = {
  account: string;
  /** A joined browser: no control is rendered, and no change is taken. */
  readOnly: boolean;
  /**
   * Signed in through a join: the token's scopes and the grant's
   * resources, which limit what is shown. Absent for a website login,
   * which scopes don't apply to (§6).
   */
  agent?: { scopes: string[]; resources?: string[] };
};

/** The join's account first (§6), then the browser's own website login. */
export function siteViewer(
  join: BrowserJoin | undefined,
  login: { account: string } | undefined,
): SiteViewer | undefined {
  if (join?.account)
    return {
      account: join.account,
      readOnly: true,
      agent: {
        scopes: join.scopes,
        ...(join.resources ? { resources: join.resources } : {}),
      },
    };
  return login ? { account: login.account, readOnly: !!join } : undefined;
}

/** Whether the viewer sees what `scope` covers in the Company's API. */
export const viewerSees = (viewer: SiteViewer, scope: string) =>
  !viewer.agent || viewer.agent.scopes.includes(scope);

/** A part of an account page, and the read scope that covers it. */
export type SitePart = { name: string; scope: string };
/**
 * What the account page says to a joined browser, as plain text: whose
 * browser it is and that nothing changes here, then the parts it doesn't
 * show for want of a scope, named with their scopes so the agent can ask
 * for them (§6), then what is never shown to an agent's browser.
 */
export function agentBrowserNotice(viewer: SiteViewer, parts: SitePart[]) {
  const missing = parts.filter((part) => !viewerSees(viewer, part.scope));
  return [
    viewer.agent
      ? "This browser belongs to an agent's session. It is signed in through the agent and shows what you allowed the agent to read. Nothing can be changed here: changes are made through the agent and wait for your approval there."
      : "This browser belongs to an agent's session. Nothing can be changed here: changes are made through the agent and wait for your approval there.",
    ...(missing.length
      ? [
          `Not shown, because the agent's permission doesn't cover it: ${missing.map((part) => `${part.name} (${part.scope})`).join(", ")}.`,
        ]
      : []),
    ...(viewer.agent
      ? [
          "Connected agents and their activity are shown only in your own browser.",
        ]
      : []),
  ];
}
/** In the login form's place, for a joined browser that isn't signed in. */
export const AGENT_BROWSER_LOGIN =
  "This browser belongs to an agent's session and isn't signed in to an account. To see an account here, the agent signs in with your permission to browse this website, then connects the browser again. The sign-in on this page is for a customer's own browser.";
/** What `/site/state` tells the page's script of a joined browser. */
export const agentBrowserState = (viewer: SiteViewer, parts: SitePart[]) =>
  viewer.readOnly
    ? {
        browser: {
          read_only: true,
          not_shown: parts
            .filter((part) => !viewerSees(viewer, part.scope))
            .map((part) => part.scope),
        },
      }
    : {};
