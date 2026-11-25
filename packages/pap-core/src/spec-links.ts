/**
 * Links into the published text of Personal Agent Protocol 1.0, so every
 * "§5.2" the lab shows leads to that section. The published pages name their
 * headings with their own ids, which are not derived from the titles
 * ("5.2 The Session header" is `#session-header`), so they are listed here
 * once, for the playground, Learn and the Companies' pages alike.
 *
 * `spec-links.test.ts` keeps the section numbers in step with the pinned text
 * in `spec/1.0`. The ids were read from the published pages on 25 November
 * 2026.
 */
const DOCS = "https://personalagentprotocol.org/docs/1.0";
export const SPEC_URL = `${DOCS}/spec`;
export const OPERATIONS_URL = `${DOCS}/extensions/operations`;
export const GUIDES_URL = `${DOCS}/guides`;

/** Section number to heading id, in `spec`. */
export const SPEC_ANCHORS: Readonly<Record<string, string>> = {
  "1": "intro",
  "1.1": "layers",
  "2": "terms",
  "3": "discovery",
  "3.1": "fields",
  "3.2": "oauth-server",
  "3.3": "extensions",
  "3.4": "versions",
  "4": "oauth",
  "4.1": "agent-identity",
  "4.2": "direct-sign-in",
  "4.3": "device-sign-in",
  "4.4": "refresh-tokens",
  "4.5": "access-tokens",
  "4.6": "revocation",
  "4.7": "scopes",
  "4.8": "oauth-additions",
  "5": "sessions",
  "5.1": "user-ids",
  "5.2": "session-header",
  "5.3": "session-verification",
  "5.4": "sign-in",
  "5.5": "ending-sessions",
  "5.6": "sending-requests",
  "6": "web-browsing",
  "7": "apis",
  "8": "conversations",
  "8.1": "conversation-protocols",
  "8.2": "conversation-requests",
  "8.3": "sending-messages",
  "8.4": "message-fields",
  "8.5": "reading-events",
  "8.6": "streaming",
  "8.7": "state",
  "8.8": "human-or-ai",
  "8.9": "handoff",
  "8.10": "direct-conversations",
  "8.11": "conversation-sign-in",
  "8.12": "closing",
  "8.13": "conversation-errors",
  "9": "task-coverage",
  "9.1": "excluded-tasks",
  "9.2": "alternatives",
  "9.3": "feedback",
  "9.4": "agent-context",
  "10": "security",
  "10.1": "untrusted-content",
  "10.2": "secrets",
  "10.3": "trust",
  "10.4": "assertion-audience",
  "10.5": "credentials",
  "10.6": "browser-join",
  "10.7": "delegated-key-security",
  "10.8": "attacker-started-sign-in",
  "11": "references",
};

/** Section number to heading id, in the Operations extension. */
export const OPERATIONS_ANCHORS: Readonly<Record<string, string>> = {
  "1": "intro",
  "2": "support",
  "3": "operation-object",
  "4": "approval-required",
  "5": "approval",
  "6": "sending-approval",
  "7": "at-most-once",
  "8": "security",
  "8.1": "approval-proof",
  "8.2": "website-security",
  "9": "references",
};

/** Heading ids that have no section number: the unnumbered headings. */
export const SPEC_EXTRA_ANCHORS = ["delegated-keys", "operator-signatures"];
export const OPERATIONS_EXTRA_ANCHORS = [
  "approval-required-apis",
  "approval-required-mcp",
  "approval-required-conversations",
  "approval-required-websites",
  "sending-approval-apis",
  "sending-approval-mcp",
  "sending-approval-conversations",
  "sending-approval-websites",
  "approval-checks",
  "declining-approval",
];
export const GUIDES_ANCHORS = [
  "about",
  "both",
  "both-secrets",
  "both-signing",
  "both-operator-signatures",
  "both-key-rotation",
  "both-fetching",
  "both-replies",
  "both-retries",
  "both-rate-limits",
  "both-transport",
  "both-interoperability",
  "agents",
  "agent-discovery",
  "agent-versions",
  "agent-user-ids",
  "agent-session-header",
  "agent-tokens",
  "agent-account-access",
  "agent-choosing-sign-in",
  "agent-direct-device",
  "agent-mediated",
  "agent-native-apps",
  "agent-browsing",
  "agent-conversations",
  "agent-interfaces",
  "agent-excluded-tasks",
  "agent-operations",
  "companies",
  "company-adoption",
  "company-versions",
  "company-without-oauth",
  "company-agents",
  "company-session-header",
  "company-sessions",
  "company-lifetimes",
  "company-scope-descriptions",
  "company-api-descriptions",
  "company-consent",
  "company-device",
  "company-mediated",
  "company-account-settings",
  "company-browsing",
  "company-scopes",
  "company-internal",
  "company-hosting",
  "company-conversation-provider",
  "company-agent-issuer",
  "company-guest",
  "company-conversations",
  "company-excluded-tasks",
  "company-operations",
  "company-errors",
];

type Document = "spec" | "operations";

/** The address of one section; the document itself when the number is unknown. */
export function specSectionUrl(section: string, document: Document = "spec") {
  const [url, anchors] =
    document === "operations"
      ? [OPERATIONS_URL, OPERATIONS_ANCHORS]
      : [SPEC_URL, SPEC_ANCHORS];
  const anchor = anchors[section];
  return anchor ? `${url}#${anchor}` : url;
}

export type SpecRefPart = { text: string; href?: string };

/**
 * A reference as the lab writes it, split into text and links:
 * "§3.4, §5.2–5.3", "§8.4 · Operations §4", "Operations §4–6", "Operations v3".
 * Numbers after "Operations" belong to the extension until the next " · ".
 * The second number of a range is a link of its own.
 */
export function specRefParts(reference: string): SpecRefPart[] {
  const parts: SpecRefPart[] = [];
  for (const segment of reference.split(/(\s·\s)/)) {
    if (/^Operations v\d+$/.test(segment)) {
      parts.push({ text: segment, href: OPERATIONS_URL });
      continue;
    }
    const document: Document = segment.startsWith("Operations")
      ? "operations"
      : "spec";
    for (const piece of segment.split(
      /(§\d+(?:\.\d+)?|(?<=[–-])\d+(?:\.\d+)?)/,
    )) {
      if (!piece) continue;
      const number = piece.match(/^§?(\d+(?:\.\d+)?)$/)?.[1];
      parts.push(
        number
          ? { text: piece, href: specSectionUrl(number, document) }
          : { text: piece },
      );
    }
  }
  return parts;
}

const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** What a link into the published text carries: it opens in a new tab. */
export const SPEC_LINK_ATTRIBUTES = 'target="_blank" rel="noopener noreferrer"';

/** The same reference as HTML, for the server-rendered Companies. */
export function specRefHtml(reference: string) {
  return specRefParts(reference)
    .map((part) =>
      part.href
        ? `<a href="${escape(part.href)}" ${SPEC_LINK_ATTRIBUTES}>${escape(part.text)}</a>`
        : escape(part.text),
    )
    .join("");
}
