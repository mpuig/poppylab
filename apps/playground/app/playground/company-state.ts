/**
 * The conversation's Companies as the page holds them: one entry for each
 * Company it is connected to, in the order they were connected, each with
 * its own sign-in, proposals and Direct Conversation, and the Companies that
 * were removed. The server says what each holds (`connections` and `former`
 * in an answer or a reload, `lib/conversation-view.ts`); the page adds only
 * what it alone knows, such as a consent tab it opened. Plain data, so each
 * step can be tested without a page.
 */
import { companyProfile } from "@poppy-lab/pap-core";
import type { DiscoveredCompany } from "@poppy-lab/pap-core";
import { canChange } from "@poppy-lab/pap-agent/account-permissions";
import { directView } from "@/lib/direct-state";
import { domainExtension } from "@poppy-lab/pap-agent/domain-extension";
import type { GuideOperation } from "@/lib/guide";
import type { ReviewOperation } from "@poppy-lab/pap-agent/operation-presentation";
import type { ShownSkill, ShownTask } from "@/lib/shown-tasks";
import type { FdxConsentRecord } from "./fdx-consent";
import type { EspiAuthorizationRecord } from "./espi-authorization";
import type { FdxStatementAccount } from "./fdx-statements";
import { accountCompany, labCompanies, labCompany } from "./companies";

/** A Company as the server names it: `origin` is what a request names. */
export type CompanyRef = { origin: string; name: string };

/** A proposal as the page holds it (see `use-playground.ts`). */
export type Operation = ReviewOperation & GuideOperation;

/** At most this many Companies in one conversation, as the server holds. */
export const MAX_COMPANIES = 3;

/** One of the conversation's Companies, as a reload or an answer tells it. */
export type ConnectionView = CompanyRef & {
  company?: DiscoveredCompany;
  url?: string;
  signedIn?: boolean;
  scopes?: string;
  authPending?: boolean;
  consentVersion?: number;
  recovery?: { error?: string };
  fdx?: boolean;
  fdxConsent?: string;
  espi?: boolean;
  espiAuthorization?: string;
  directConversation?: unknown;
  operations?: Operation[];
  excludedTasks?: ShownTask[];
  skills?: ShownSkill[];
};

/** A Company that was removed, and approvals it left with an unknown outcome. */
export type Former = CompanyRef & { url: string; operations: Operation[] };

type GrantRecord = FdxConsentRecord | EspiAuthorizationRecord;

export type CompanyState = CompanyRef & {
  /** Its address as it was connected, without a trailing slash. */
  url: string;
  /** Its discovery: what the Inspector and the account row read. */
  company?: DiscoveredCompany;
  signedIn: boolean;
  scopes: string;
  /** Goes up with each completed sign-in there. */
  consentVersion: number;
  /** The Company no longer takes the sign-in: what to tell the User. */
  recovery?: string;
  /** Use FDX or Use ESPI, kept by the server for this Company. */
  extensionOn: boolean;
  /** The FDX consent or ESPI authorization of this sign-in. */
  grantId?: string;
  operations: Operation[];
  excludedTasks: ShownTask[];
  skills: ShownSkill[];
  /** §8.10 with this Company. */
  direct: ReturnType<typeof directView>;
  /** The page's own: a consent tab it opened, and the sign-ins before it. */
  signingIn?: { baseline: number; since: number };
  /** The grant's record as the Company last returned it. */
  grantRecord?: GrantRecord;
  /** The User revoked the grant, or found it had ended. */
  grantRevoked?: "revoked" | "already_ended";
  /** The shared accounts' statements, once the User asked for them. */
  statements?: FdxStatementAccount[];
};

const bare = (url: string) => url.replace(/\/$/, "");

/** The origin of an address, or nothing for one that isn't one. */
export function originOf(url: string | undefined) {
  try {
    return url ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A Company as the server describes it, with what the page alone knew of
 * it before: a consent tab still open, and the grant's record and
 * statements while the grant is the same one.
 */
export function companyFromView(
  view: ConnectionView,
  before?: CompanyState,
): CompanyState {
  const company = view.company ?? before?.company;
  const listed = company ? domainExtension(companyProfile(company)) : undefined;
  const grantId = view.espiAuthorization ?? view.fdxConsent;
  const signedIn = !!view.signedIn;
  const same = !!grantId && grantId === before?.grantId;
  // A consent tab stays open until a sign-in completes there; the poll
  // says when it was declined.
  const signing =
    before?.signingIn &&
    !(signedIn && (view.consentVersion ?? 0) > before.signingIn.baseline)
      ? before.signingIn
      : undefined;
  return {
    origin: view.origin,
    name: view.name,
    url: bare(company?.requestedUrl ?? view.url ?? view.origin),
    ...(company ? { company } : {}),
    signedIn,
    scopes: view.scopes ?? "",
    consentVersion: view.consentVersion ?? 0,
    ...(view.recovery?.error ? { recovery: view.recovery.error } : {}),
    extensionOn: !!(listed && view[listed.key]),
    ...(grantId ? { grantId } : {}),
    operations: view.operations ?? [],
    excludedTasks: view.excludedTasks ?? [],
    skills: view.skills ?? [],
    direct: directView(view.directConversation),
    ...(signing ? { signingIn: signing } : {}),
    ...(same && before?.grantRecord ? { grantRecord: before.grantRecord } : {}),
    ...(same && before?.statements ? { statements: before.statements } : {}),
    ...(!signedIn && before?.grantRevoked
      ? { grantRevoked: before.grantRevoked }
      : {}),
  };
}

/** The conversation's Companies as the server now lists them. */
export function companiesFrom(
  views: ConnectionView[] | undefined,
  before: CompanyState[] = [],
): CompanyState[] {
  return (views ?? []).map((view) =>
    companyFromView(
      view,
      before.find((c) => c.origin === view.origin),
    ),
  );
}

/** The Companies that were removed, as a reload or an answer lists them. */
export const formerFrom = (former: unknown): Former[] =>
  Array.isArray(former)
    ? (former as Former[]).filter(
        (f) => typeof f?.origin === "string" && typeof f.name === "string",
      )
    : [];

/** Changes one Company and leaves the others as they are. */
export function patchCompany(
  companies: CompanyState[],
  origin: string | undefined,
  change:
    Partial<CompanyState> | ((company: CompanyState) => Partial<CompanyState>),
): CompanyState[] {
  return companies.map((c) =>
    c.origin === origin
      ? { ...c, ...(typeof change === "function" ? change(c) : change) }
      : c,
  );
}

/**
 * What a chat answer says of the Company the turn was with: its sign-in,
 * proposals, tasks and Direct Conversation. The answer's own members are
 * that Company's (`from`), so no other Company changes.
 */
export function afterTurn(
  company: CompanyState,
  data: {
    signedIn?: boolean;
    scopes?: string;
    recovery?: { error?: string };
    operations?: Operation[];
    excludedTasks?: ShownTask[];
    skills?: ShownSkill[];
  },
): CompanyState {
  const next: CompanyState = {
    ...company,
    signedIn: !!data.signedIn,
    scopes: data.scopes ?? "",
    operations: data.operations ?? [],
    excludedTasks: data.excludedTasks ?? [],
    skills: data.skills ?? [],
    direct: directView(data),
  };
  if (data.recovery?.error) next.recovery = data.recovery.error;
  else delete next.recovery;
  return next;
}

/**
 * The Company no longer takes the sign-in. Until the User signs in again
 * there is nothing to talk directly from, as a reload is told.
 */
export const accessLost = (company: CompanyState): CompanyState => ({
  ...company,
  signedIn: false,
  scopes: "",
  direct: { ...company.direct, canTalkDirectly: false },
});

/** Signed out there (sign-out, a revoked grant): what goes from the page. */
export function signedOut(company: CompanyState): CompanyState {
  const next: CompanyState = {
    ...company,
    signedIn: false,
    scopes: "",
    operations: [],
    direct: directView(),
  };
  delete next.signingIn;
  delete next.grantId;
  delete next.grantRecord;
  delete next.statements;
  delete next.recovery;
  return next;
}

/** The Company offers sign-in to agents, and this playground may use it. */
export const offersSignIn = (company: CompanyState) =>
  !!company.company &&
  companyProfile(company.company).signIn.direct &&
  accountCompany(company.origin);

/** The grant lets Iris propose changes there, not only read. */
export const mayChange = (company: CompanyState) =>
  canChange(
    company.company ? companyProfile(company.company) : undefined,
    company.scopes,
  );

/**
 * The Company's state in a few plain words, for its item in the Companies
 * bar: how Iris may use it now.
 */
export function stateWords(company: CompanyState) {
  if (company.signingIn) return "Sign-in under way";
  if (company.recovery && !company.signedIn) return "Access lost";
  if (company.signedIn)
    return mayChange(company)
      ? "Signed in · can propose changes"
      : "Signed in · read only";
  return "Public access";
}

/** The lab's colour for a Company, when it is one of the lab's. */
export const brandOf = (origin: string | undefined) =>
  labCompany(origin)?.brand;

/** The lab's Companies the conversation isn't connected to yet. */
export const notConnected = (companies: Pick<CompanyState, "origin">[]) =>
  labCompanies.filter(
    (lab) => !companies.some((c) => c.origin === originOf(lab.url)),
  );

/**
 * What removing the Company takes with it, when that is anything the User
 * may want to keep: the sign-in, and proposals that wait. Nothing for a
 * Company that is public only, which goes without asking.
 */
export function removalLoss(company: CompanyState, now = Date.now()) {
  const waiting = company.operations.filter(
    (op) => op.state === "proposed" && Date.parse(op.expires_at) > now,
  ).length;
  const lost: string[] = [];
  if (company.signedIn)
    lost.push(
      `That revokes the access you gave Iris at ${company.name}, and what Iris read with your account there no longer shows.`,
    );
  if (waiting)
    lost.push(
      waiting === 1
        ? "The proposal that waits for your approval goes too; nothing in it was approved."
        : `The ${waiting} proposals that wait for your approval go too; nothing in them was approved.`,
    );
  return lost;
}

/**
 * The Company the screen speaks about when it has to choose one: the one
 * with the proposal that changed last while it waits for the User, then
 * the one the last turn was with, then the first connected.
 */
export function inFocus(
  companies: CompanyState[],
  lastTurn: string | undefined,
  waitsAt?: string,
) {
  return (
    companies.find((c) => c.origin === waitsAt) ??
    companies.find((c) => c.origin === lastTurn) ??
    companies[0]
  );
}
