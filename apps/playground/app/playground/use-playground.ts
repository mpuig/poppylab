/**
 * The playground's state and its server calls: discovery, chat and account
 * actions (sign-in, sign-out, remove, approve, decline, retry). Each
 * conversation has its own address, `/playground/<id>`, and works with up
 * to three Companies: connecting the first starts one (so does a message
 * with none), the bar or the User's words add and remove the others, and
 * loading the address restores it (read-only once it has ended). The state
 * of each Company is its own (`company-state.ts`), and every account action
 * names the Company it is for. Rendering lives in the components; nothing
 * here touches the DOM except the sign-in popups, the `?company=` query and
 * the address.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { companyProfile } from "@poppy-lab/pap-core";
import type { DiscoveryTraceStep } from "@poppy-lab/pap-core";
import { initialModel, type ModelConfig } from "@/lib/model-options";
import {
  canRequestChanges,
  consentOutcome,
  missingExtensionScopes,
} from "@poppy-lab/pap-agent/account-permissions";
import { domainExtension } from "@poppy-lab/pap-agent/domain-extension";
import { applyingLine, LOG_LIMITS, statementLine } from "@/lib/inspector-log";
import {
  nextAutoApproval,
  usesAllowance,
  type Allowance,
  type ApprovalAnswer,
} from "@poppy-lab/pap-agent/auto-approval";
import { withOperations } from "@/lib/operation-list";
import {
  loadApprovals,
  loadInstruction,
  recordApproval,
  saveInstruction,
  type Instruction,
} from "@poppy-lab/pap-agent/standing-instructions";
import {
  exampleUrl,
  historyToMessages,
  labCompany,
  type Choice,
  type CompanyRef,
  type Message,
} from "./companies";
import {
  accessLost,
  afterTurn,
  companiesFrom,
  formerFrom,
  MAX_COMPANIES,
  mayChange,
  originOf,
  patchCompany,
  signedOut,
  type CompanyState,
  type Former,
  type Operation,
} from "./company-state";
import {
  answerLines,
  keptLines,
  linesFor,
  turnMessages,
  type ChatAnswer,
  type PageLine,
} from "./answers";
import { rememberSignInCompany } from "./sign-in/company";

/** The conversation the address names, if it names one. */
const conversationInAddress = () =>
  /^\/playground\/([A-Za-z0-9_-]{16,64})\/?$/.exec(
    window.location.pathname,
  )?.[1];
const CONVERSATION = "X-Poppy-Conversation";
/** On a refusal: the conversation the request named has ended. */
const ENDED = "X-Poppy-Conversation-Ended";
/** How long a consent tab is waited for before the page stops asking. */
const SIGN_IN_WAIT = 300000;

/**
 * A domain extension's grant, as the account row reads and revokes it: the
 * FDX consent, or the ESPI authorization (its subscription).
 */
const GRANTS = {
  fdx: {
    read: "fdx_consent",
    revoke: "fdx_revoke",
    field: "consent",
    name: "FDX consent",
  },
  espi: {
    read: "espi_authorization",
    revoke: "espi_revoke",
    field: "authorization",
    name: "ESPI authorization",
  },
} as const;

/** A chat answer, with what it says of its Company and the conversation. */
type ChatReply = ChatAnswer &
  Parameters<typeof afterTurn>[1] & {
    code?: string;
    error?: string;
    conversation?: boolean;
    connections?: unknown;
    former?: unknown;
    history?: unknown;
    log?: unknown;
  };

/** §8.10: the User's own actions on a Direct Conversation. */
type DirectAction = "say" | "start" | "accept" | "decline" | "close";

/** The domain extension a Company lists, valid, for Use FDX or Use ESPI. */
export const extensionOf = (company: CompanyState) =>
  domainExtension(
    company.company ? companyProfile(company.company) : undefined,
  );

export function usePlayground(options: { onConnected?: () => void } = {}) {
  const [companyUrl, setCompanyUrl] = useState(exampleUrl);
  /** The address form is open: another Company's address. */
  const [addressOpen, setAddressOpen] = useState(false);
  /**
   * The bar's open panel: a Company's, by origin, or "add". A view only:
   * which Company a message is for is never chosen there.
   */
  const [panel, setPanel] = useState<string | undefined>();
  // The conversation this page shows. The ref serves requests in flight.
  const [conversation, setConversation] = useState<string | undefined>();
  const current = useRef<string | undefined>(undefined);
  /** The `?company=` link was followed once (effects run twice in development). */
  const arrived = useRef(false);
  /** Ended conversations are read-only; `keptUntil` is when they go. */
  const [ended, setEnded] = useState<{ keptUntil?: number } | undefined>();
  /** The address names a conversation this browser can't open. */
  const [missing, setMissing] = useState(false);
  /**
   * Takes the conversation the server names and puts it in the address. A
   * request the server refused because this page's conversation has ended
   * names none: the page then shows it as ended. Says whether the page was
   * moved from another conversation it showed.
   */
  const adopt = (response: Response) => {
    if (current.current && response.headers.get(ENDED) === current.current)
      void noticeEnded();
    const id = response.headers.get(CONVERSATION);
    if (!id || id === current.current) return false;
    const moved = !!current.current;
    current.current = id;
    setConversation(id);
    setEnded(undefined);
    setMissing(false);
    window.history.replaceState(null, "", `/playground/${id}`);
    return moved;
  };
  const named = (): Record<string, string> =>
    current.current ? { [CONVERSATION]: current.current } : {};
  const [modelConfig, setModelConfig] = useState<ModelConfig>(initialModel);
  const configureModel = useCallback(
    (config: ModelConfig) => setModelConfig(config),
    [],
  );
  /** The conversation's Companies, in the order they were connected. */
  const [companies, setCompanies] = useState<CompanyState[]>([]);
  /** The same, for a callback that runs after the render that set them. */
  const shownCompanies = useRef(companies);
  shownCompanies.current = companies;
  /** The ones that were removed, for what the page still shows from them. */
  const [former, setFormer] = useState<Former[]>([]);
  /** The Company the last turn was with, or the one just connected. */
  const [lastTurn, setLastTurn] = useState<string | undefined>();
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState("");
  /** What adding a Company ran into, for the bar that asked. */
  const [addError, setAddError] = useState("");
  /** What removing one ran into, by the Company it was for. */
  const [removeError, setRemoveError] = useState<
    { origin: string; text: string } | undefined
  >();
  /** A line under the bar about the Companies: one was removed. */
  const [barNote, setBarNote] = useState("");
  const [failedTrace, setFailedTrace] = useState<DiscoveryTraceStep[]>([]);
  const [task, setTask] = useState("");
  /**
   * The Company the User chose for the next message, with several. None:
   * Iris decides, which today is the Company of the last turn or a question
   * with a button for each. It is for one message: the next goes to the
   * Company of the last turn anyway, until the User chooses again.
   */
  const [target, setTarget] = useState<string | undefined>();
  const [messages, setMessages] = useState<Message[]>([]);
  /**
   * The Inspector's "Session & API calls". The server keeps the same lines
   * with the conversation (`inspector-log.ts`), within the same count, so a
   * reload lists them again.
   */
  const [chatLog, setChatLog] = useState<PageLine[]>([]);
  const addTrace = (lines: string[] | undefined, from?: CompanyRef) =>
    setChatLog((old) =>
      [...old, ...linesFor(lines, from)].slice(-LOG_LIMITS.lines),
    );
  /** A chat answer's lines: with several Companies, each with its own. */
  const addAnswerLines = (data: ChatReply, from?: CompanyRef) =>
    setChatLog((old) =>
      [...old, ...answerLines(data, from)].slice(-LOG_LIMITS.lines),
    );
  const [sending, setSending] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  /** The next message starts a Direct Conversation with this Company. */
  const [startingDirect, setStartingDirect] = useState<string | undefined>();
  /** The User's standing instruction at each Company, if they wrote one. */
  const [instructions, setInstructions] = useState<
    Record<string, Instruction | undefined>
  >({});
  /** The revisions each Company's instruction was tried on, once each. */
  const decided = useRef(new Map<string, Set<string>>());
  const decidedAt = (origin: string) => {
    let set = decided.current.get(origin);
    if (!set) decided.current.set(origin, (set = new Set()));
    return set;
  };
  const busy = sending || discovering || accountBusy;
  const refOf = (origin: string): CompanyRef => ({
    origin,
    name: companies.find((c) => c.origin === origin)?.name ?? origin,
  });
  const nameAt = (origin: string) =>
    companies.find((c) => c.origin === origin)?.name ?? "the company";

  /**
   * Shows the conversation as the server keeps it: its Companies, its words
   * and its Inspector lines. A reload, History and a page moved to another
   * conversation all read it.
   */
  async function restore(id: string, words = true) {
    const data = await fetch(`/api/account?conversation=${id}`).then((r) =>
      r.json(),
    );
    if (id !== current.current) return;
    if (data.missing) {
      current.current = undefined;
      setConversation(undefined);
      setMissing(true);
      return;
    }
    if (data.readOnly) setEnded({ keptUntil: data.keptUntil });
    setCompanies((before) => companiesFrom(data.connections, before));
    setFormer(formerFrom(data.former));
    if (!words) return;
    const shown = historyToMessages(data.history);
    setMessages(shown);
    // The Company the last turn was with, still connected.
    const views: Array<{ origin: string }> = data.connections ?? [];
    setLastTurn(
      shown
        .map((m) => m.from?.origin)
        .filter((o) => views.some((v) => v.origin === o))
        .at(-1),
    );
    setChatLog(keptLines(data.log));
    const lost = (data.connections ?? []).find(
      (c: { recovery?: { error?: string } }) => c.recovery?.error,
    );
    if (lost) setError(lost.recovery.error);
  }

  // Restore the conversation the address names, or start empty with the
  // Company a link named (?company=).
  useEffect(() => {
    const id = conversationInAddress();
    if (!id) {
      const wanted = new URLSearchParams(window.location.search).get("company");
      if (wanted && /^https?:\/\/[^\s]{1,280}$/.test(wanted)) {
        const url = wanted.replace(/\/$/, "");
        setCompanyUrl(url);
        // A link to one of the lab's own Companies connects straight away;
        // any other address only fills the form, for the visitor to send.
        if (labCompany(url) && !arrived.current) {
          arrived.current = true;
          void connectTo(url);
        } else if (!labCompany(url)) setAddressOpen(true);
      }
      return;
    }
    current.current = id;
    setConversation(id);
    void restore(id).catch(() => {});
    // Run once, for the address the page was opened at.
  }, []);

  /**
   * A conversation ends at the server: thirty minutes after its start, or
   * when a sixth one pushes it out. A tab left open isn't told, and still
   * offers a message box. So the page asks, and when the conversation has
   * ended it shows what History shows: read-only, signed out, each
   * proposal as it ended. What is on screen stays where it is.
   */
  const asking = useRef(false);
  async function noticeEnded() {
    const id = current.current;
    if (!id || asking.current) return;
    asking.current = true;
    try {
      const response = await fetch(`/api/account?conversation=${id}`);
      const data = await response.json();
      if (id !== current.current || !data.readOnly) return;
      setEnded({ keptUntil: data.keptUntil });
      setCompanies((before) =>
        companiesFrom(data.connections, before).map((c) => {
          const next: CompanyState = { ...c, signedIn: false, scopes: "" };
          delete next.signingIn;
          delete next.grantId;
          return next;
        }),
      );
      setFormer(formerFrom(data.former));
      // The notice above the chat says it; a refused request said it too.
      setError("");
    } catch {
      // Asked again the next time the page is looked at.
    } finally {
      asking.current = false;
    }
  }
  // Asked when the page is looked at again, before anything is typed. A
  // request that names an ended conversation is refused and asks as well.
  useEffect(() => {
    if (!conversation || ended) return;
    const look = () => {
      if (document.visibilityState === "visible") void noticeEnded();
    };
    window.addEventListener("focus", look);
    document.addEventListener("visibilitychange", look);
    return () => {
      window.removeEventListener("focus", look);
      document.removeEventListener("visibilitychange", look);
    };
    // noticeEnded reads the conversation from a ref and only sets state.
  }, [conversation, ended]);

  // While a consent tab is open at any Company, poll until each completes
  // or is declined. Two can be under way at once, at two Companies.
  const signingKey = companies
    .filter((c) => c.signingIn)
    .map((c) => `${c.origin}:${c.signingIn!.baseline}`)
    .join();
  useEffect(() => {
    if (!signingKey) return;
    let cancelled = false;
    const interval = setInterval(() => {
      if (!current.current) return;
      void fetch(`/api/account?conversation=${current.current}`)
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          const views: Array<{
            origin: string;
            signedIn: boolean;
            authPending: boolean;
            consentVersion: number;
          }> = data.connections ?? [];
          // Read from the Companies as the page shows them now: an update
          // function runs later, so it can't tell this callback anything.
          let completed = false;
          const declined: string[] = [];
          const late: string[] = [];
          for (const c of shownCompanies.current) {
            if (!c.signingIn) continue;
            const view = views.find((v) => v.origin === c.origin);
            const outcome = view
              ? consentOutcome(view, c.signingIn.baseline)
              : "not_completed";
            if (outcome === "completed") completed = true;
            else if (outcome === "not_completed") declined.push(c.origin);
            else if (Date.now() - c.signingIn.since > SIGN_IN_WAIT)
              late.push(c.origin);
          }
          if (!completed && !declined.length && !late.length) return;
          setCompanies((before) => {
            const stop = (c: CompanyState) => {
              if (!declined.includes(c.origin) && !late.includes(c.origin))
                return c;
              const next = { ...c };
              delete next.signingIn;
              return next;
            };
            return completed
              ? companiesFrom(data.connections, before).map((c) => {
                  // A completed sign-in leaves the grant it replaced.
                  const next = stop(c);
                  if (next.signedIn) delete next.grantRevoked;
                  return next;
                })
              : before.map(stop);
          });
          if (completed) {
            // A sign-in may be for another account: the page shows what the
            // conversation still shows, and the lines that follow it.
            setMessages(historyToMessages(data.history));
            setChatLog(keptLines(data.log));
            setFormer(formerFrom(data.former));
          }
          const nameOf = (origin: string) =>
            (data.connections as CompanyRef[] | undefined)?.find(
              (v) => v.origin === origin,
            )?.name ?? "the company";
          for (const origin of declined)
            setError(
              `Consent was not completed at ${nameOf(origin)}. Your previous access there has not changed. You can try again.`,
            );
          for (const origin of late)
            setError(
              `No consent completion was received from ${nameOf(origin)}. Reload to check account status before trying again.`,
            );
        })
        .catch(() => {});
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [signingKey]);

  /** Shows the operations an answer carries, as the server now holds them. */
  const showOperations = (
    origin: string,
    ...answered: Array<Operation | undefined>
  ) =>
    setCompanies((all) =>
      patchCompany(all, origin, (c) => ({
        operations: withOperations(c.operations, ...answered),
      })),
    );

  /**
   * What an answer carries of the conversation as a whole: its Companies,
   * when they changed, and what it shows now, when something went from it
   * (a sign-out, a removal, a Company taking the access back). `said` is
   * this request's own line, which follows what the conversation showed.
   */
  function takeConversation(
    data: {
      connections?: unknown;
      former?: unknown;
      history?: unknown;
      log?: unknown;
    },
    said: Message[] = [],
  ) {
    if (Array.isArray(data.connections)) {
      const views = data.connections as Array<{ origin: string }>;
      // A Company just connected is the one the conversation is with now,
      // as the server takes it; one that went is with it no longer.
      const added = views.find(
        (v) => !companies.some((c) => c.origin === v.origin),
      );
      if (added) setLastTurn(added.origin);
      else if (lastTurn && !views.some((v) => v.origin === lastTurn))
        setLastTurn(undefined);
      setCompanies((before) =>
        companiesFrom(data.connections as never, before),
      );
    }
    if (Array.isArray(data.former)) setFormer(formerFrom(data.former));
    if (Array.isArray(data.history))
      setMessages([...historyToMessages(data.history as never), ...said]);
    if (Array.isArray(data.log)) setChatLog(keptLines(data.log));
  }

  /**
   * The Company no longer takes the sign-in. An answer to the request in
   * which Iris learned it carries what the conversation still shows: the
   * part shown signed out. What was shown with the account goes from the
   * page too, as after a sign-in.
   */
  function lostAt(
    origin: string,
    data: { history?: unknown; operations?: Operation[] },
  ) {
    setCompanies((all) =>
      patchCompany(all, origin, (c) => ({
        ...accessLost(c),
        ...(Array.isArray(data.history)
          ? { operations: data.operations ?? [] }
          : {}),
      })),
    );
    if (startingDirect === origin) setStartingDirect(undefined);
  }

  /** The body and headers of an account action for one Company. */
  const accountRequest = (origin: string, body: Record<string, unknown>) => ({
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-PAP-Company":
        companies.find((c) => c.origin === origin)?.url ?? origin,
      ...named(),
    },
    body: JSON.stringify({ ...body, company: origin }),
  });

  async function accountAction(
    action: string,
    origin: string,
    op?: Operation,
    access: "read" | "write" = "read",
    /** An agent approval: the User's standing instruction, rechecked server-side. */
    byInstruction?: Instruction,
    /** Told how the route answered, if the request was sent at all. */
    answered?: (answer: ApprovalAnswer) => void,
  ) {
    if (busy || ended) return;
    const company = companies.find((c) => c.origin === origin);
    if (!company) return;
    // One tab for each Company, so two sign-ins can be under way at once.
    const popup =
      action === "signin"
        ? window.open("about:blank", `company-signin-${new URL(origin).host}`)
        : null;
    setAccountBusy(true);
    setError("");
    let answer: ApprovalAnswer = "lost";
    try {
      const response = await fetch(
        "/api/account",
        accountRequest(origin, {
          action,
          ...(action === "signin" ? { access } : {}),
          id: op?.operation_id,
          revision: op?.revision,
          ...(byInstruction ? { instruction: byInstruction } : {}),
        }),
      );
      adopt(response);
      const data = await response.json();
      answer = { status: response.status, operation: data.operation };
      // The route's lines for the log: how an approval went, a sign-out.
      if (action !== "signout") addTrace(data.trace, refOf(origin));
      if (!response.ok) {
        if (data.code === "account_unavailable") {
          lostAt(origin, data);
          takeConversation(data);
        }
        // New terms (Operations v3) or an unknown outcome: show current state.
        // New terms under another ID come with the operation they replace.
        showOperations(origin, data.replaced, data.operation);
        if (data.code === "outcome_unknown" && op)
          showOperations(origin, { ...op, state: "uncertain" });
        // A refusal the operation carries is on its card, where it stays
        // until the operation changes: not above the transcript as well.
        if (data.error && data.operation?.result?.summary === data.error)
          return;
        throw new Error(data.error);
      }
      if (data.url) {
        if (popup) {
          popup.opener = null;
          // For the page that tab lands on, which names the Company: in
          // that tab's own storage, so a second sign-in elsewhere doesn't
          // change what this one says.
          rememberSignInCompany(company.name, () => popup.sessionStorage);
          popup.location.href = data.url;
          setCompanies((all) =>
            patchCompany(all, origin, {
              signingIn: {
                baseline: data.consentVersion ?? 0,
                since: Date.now(),
              },
            }),
          );
        } else
          throw new Error(
            "Allow popups for this site, then try the sign-in or permission request again.",
          );
      }
      if (action === "signout") {
        // What the conversation still shows: what came from the other
        // Companies stays. Then this request's own lines.
        setCompanies((all) => patchCompany(all, origin, signedOut));
        takeConversation(data);
        if (startingDirect === origin) setStartingDirect(undefined);
        addTrace(data.trace, refOf(origin));
      }
      if (data.operation) showOperations(origin, data.operation);
    } catch (caught) {
      popup?.close();
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : "Account action failed.",
      );
    } finally {
      // Before the page is idle again, so the next decision already sees it.
      answered?.(answer);
      setAccountBusy(false);
    }
  }

  /**
   * Takes a Company out of the conversation, which goes on with the
   * others. The page has already asked when that takes something with it;
   * the server refuses while an approval sent there has an unknown outcome.
   */
  async function removeCompany(origin: string) {
    if (busy || ended) return;
    setAccountBusy(true);
    setRemoveError(undefined);
    setBarNote("");
    setError("");
    try {
      const response = await fetch(
        "/api/account",
        accountRequest(origin, { action: "remove" }),
      );
      adopt(response);
      const data = await response.json();
      if (!response.ok) {
        if (Array.isArray(data.operations))
          showOperations(origin, ...data.operations);
        setRemoveError({
          origin,
          text:
            data.error ??
            `${nameAt(origin)} couldn't be removed. Nothing was changed; try again.`,
        });
        return;
      }
      const name = data.removed?.name ?? nameAt(origin);
      takeConversation(data);
      addTrace(data.trace, refOf(origin));
      if (startingDirect === origin) setStartingDirect(undefined);
      if (lastTurn === origin) setLastTurn(undefined);
      setBarNote(
        [`${name} was removed from this conversation.`, data.notice]
          .filter(Boolean)
          .join(" "),
      );
    } catch {
      setRemoveError({
        origin,
        text: `${nameAt(origin)} couldn't be removed. Nothing was changed; try again.`,
      });
    } finally {
      setAccountBusy(false);
    }
  }

  /**
   * Use FDX or Use ESPI on or off for one Company. The server starts a new
   * Session there, whose declarations then say so (§3.4).
   */
  async function chooseExtension(origin: string, enabled: boolean) {
    const company = companies.find((c) => c.origin === origin);
    const extension = company && extensionOf(company);
    if (busy || ended || !extension) return;
    const { key, label } = extension;
    setAccountBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api/account",
        accountRequest(origin, { action: key, enabled }),
      );
      adopt(response);
      const data = await response.json();
      addTrace(data.trace, refOf(origin));
      if (!response.ok) throw new Error(data.error);
      // The new Session hasn't read its tasks yet.
      setCompanies((all) =>
        patchCompany(all, origin, {
          extensionOn: !!data[key],
          excludedTasks: [],
          skills: [],
        }),
      );
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : `Could not change Use ${label}.`,
      );
    } finally {
      setAccountBusy(false);
    }
  }

  /** A grant action of the User's at one Company: read or revoke it. */
  const grantCall = async (origin: string, action: string) => {
    const response = await fetch(
      "/api/account",
      accountRequest(origin, { action }),
    );
    adopt(response);
    return { response, data: await response.json() };
  };
  /** The grant to show, and to offer to revoke, at a Company. */
  const grantShown = (c: CompanyState) =>
    c.extensionOn && c.signedIn && !!c.grantId && !!extensionOf(c);

  // Each grant's status and what it shares, read once for each id.
  const grantRead = useRef(new Map<string, string>());
  useEffect(() => {
    if (busy || ended) return;
    const c = companies.find(
      (c) => grantShown(c) && grantRead.current.get(c.origin) !== c.grantId,
    );
    const extension = c && extensionOf(c);
    if (!c || !extension) return;
    const grants = GRANTS[extension.key];
    const id = c.grantId!;
    grantRead.current.set(c.origin, id);
    setAccountBusy(true);
    void grantCall(c.origin, grants.read)
      .then(({ response, data }) => {
        addTrace(data.trace, refOf(c.origin));
        if (data.code === "account_unavailable") {
          lostAt(c.origin, data);
          takeConversation(data);
          setError(data.error ?? "");
        }
        // A record the Company didn't return shows the id alone.
        const record = data[grants.field];
        setCompanies((all) =>
          patchCompany(all, c.origin, {
            grantRecord:
              response.ok && record?.id === id
                ? record
                : { id, unavailable: true },
          }),
        );
      })
      .catch(() =>
        setCompanies((all) =>
          patchCompany(all, c.origin, {
            grantRecord: { id, unavailable: true },
          }),
        ),
      )
      .finally(() => setAccountBusy(false));
    // grantCall is recreated each render and reads current state.
  }, [companies, busy, ended]);

  /**
   * The User revokes the FDX consent or the ESPI authorization at one
   * Company. The Company ends the grant and its tokens, so the page signs
   * out there as sign-out does; Iris never does this.
   */
  async function revokeGrant(origin: string) {
    const company = companies.find((c) => c.origin === origin);
    const extension = company && extensionOf(company);
    if (busy || ended || !company || !grantShown(company) || !extension) return;
    const grants = GRANTS[extension.key];
    setAccountBusy(true);
    setError("");
    try {
      const { response, data } = await grantCall(origin, grants.revoke);
      if (data.code === "account_unavailable") {
        lostAt(origin, data);
        takeConversation(data);
      }
      if (!response.ok) {
        addTrace(data.trace, refOf(origin));
        throw new Error(data.error);
      }
      setCompanies((all) =>
        patchCompany(all, origin, (c) => ({
          ...signedOut(c),
          grantRevoked:
            data.revoked === "already_ended" ? "already_ended" : "revoked",
        })),
      );
      takeConversation(data);
      addTrace(data.trace, refOf(origin));
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : `Could not revoke the ${grants.name}.`,
      );
    } finally {
      setAccountBusy(false);
    }
  }

  /** Statements need their data cluster in this sign-in, with Use FDX on. */
  const statementsShown = (c: CompanyState) =>
    grantShown(c) &&
    extensionOf(c)?.key === "fdx" &&
    c.scopes.split(" ").includes("fdx:STATEMENTS");
  /** Lists the shared accounts' statements (poppylab.dev/fdx v1). */
  async function listFdxStatements(origin: string) {
    const company = companies.find((c) => c.origin === origin);
    if (busy || ended || !company || !statementsShown(company)) return;
    setAccountBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api/account",
        accountRequest(origin, { action: "fdx_statements" }),
      );
      adopt(response);
      const data = await response.json();
      addTrace(data.trace, refOf(origin));
      if (!response.ok || !Array.isArray(data.accounts))
        throw new Error(data.error);
      setCompanies((all) =>
        patchCompany(all, origin, { statements: data.accounts }),
      );
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : "Could not list the statements.",
      );
    } finally {
      setAccountBusy(false);
    }
  }
  /**
   * Downloads one statement's PDF through the server, which fetches it from
   * the bank. The file goes to the User's browser, never to Iris.
   */
  async function downloadFdxStatement(
    origin: string,
    accountId: string,
    statementId: string,
  ) {
    const company = companies.find((c) => c.origin === origin);
    if (busy || ended || !company || !statementsShown(company)) return;
    setAccountBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api/account",
        accountRequest(origin, {
          action: "fdx_statement",
          accountId,
          statementId,
        }),
      );
      adopt(response);
      if (
        !response.ok ||
        response.headers.get("content-type") !== "application/pdf"
      ) {
        const data = await response.json().catch(() => ({}));
        addTrace(data.trace, refOf(origin));
        throw new Error(data.error);
      }
      const file = await response.blob();
      const name =
        /filename="([A-Za-z0-9._-]+)"/.exec(
          response.headers.get("content-disposition") ?? "",
        )?.[1] ?? "statement.pdf";
      const link = document.createElement("a");
      link.href = URL.createObjectURL(file);
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 10000);
      // The file carries no lines: the server keeps this one in the same
      // words.
      addTrace([statementLine(statementId, file.size)], refOf(origin));
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : "Could not download the statement.",
      );
    } finally {
      setAccountBusy(false);
    }
  }

  // The User's standing instruction at each Company, if they wrote one.
  const origins = companies.map((c) => c.origin).join();
  useEffect(() => {
    setInstructions(
      Object.fromEntries(
        companies.map((c) => [c.origin, loadInstruction(c.origin)]),
      ),
    );
    // Read again only when the Companies change, not their state.
  }, [origins]);
  function setLimit(origin: string, next: Instruction | null) {
    saveInstruction(origin, next);
    setInstructions((all) => ({ ...all, [origin]: next ?? undefined }));
  }

  /**
   * The revisions the hour's allowance left to the User, with the reason,
   * for their cards: a revision is looked at once, so it keeps waiting even
   * when the hour has passed. Keyed by Company, operation and revision.
   */
  const [heldBack, setHeldBack] = useState<Record<string, string>>({});
  /**
   * The Inspector's line for terms the standing instruction leaves to the
   * User. The server makes the check again and keeps the line with the
   * conversation, once, so a reload and History list it as it was; the page
   * lists what the server answers. A request that fails lists nothing: the
   * card still says why.
   */
  async function noteLeftToUser(
    origin: string,
    op: Operation,
    allowance?: Allowance,
  ) {
    setAccountBusy(true);
    try {
      const response = await fetch(
        "/api/account",
        accountRequest(origin, {
          action: "not_applied",
          id: op.operation_id,
          revision: op.revision,
          instruction: instructions[origin],
          ...(allowance ? { allowance } : {}),
        }),
      );
      const data = await response.json();
      addTrace(data.trace, refOf(origin));
      if (response.ok) showOperations(origin, data.operation);
    } catch {
      // Nothing to say: no approval was asked for.
    } finally {
      setAccountBusy(false);
    }
  }
  // A fixed check against the exact terms; each revision is tried once, at
  // each Company with its own instruction. Anything it does not cover stays
  // for the User in the Needs you panel, where its card says why
  // (`leftToUser`), and the Inspector says it too.
  useEffect(() => {
    for (const c of companies) {
      const instruction = instructions[c.origin];
      const next = nextAutoApproval({
        operations: c.operations,
        instruction,
        signedIn: c.signedIn,
        busy,
        decided: decidedAt(c.origin),
        recent: loadApprovals(c.origin),
      });
      if (!next) continue;
      if (next.kind === "left") {
        const { op, reason, allowance } = next;
        if (allowance)
          setHeldBack((old) => ({
            ...old,
            [`${c.origin} ${op.operation_id}:${op.revision}`]: reason,
          }));
        // After a reload the conversation already keeps this reason's line.
        if (op.notApplied !== reason)
          void noteLeftToUser(c.origin, op, allowance);
        return;
      }
      // The next line of the log says how the Company answered. The server
      // keeps this one in the same words when its own check agrees.
      addTrace([applyingLine(next.covered)], refOf(c.origin));
      const { cents } = next;
      const origin = c.origin;
      void accountAction(
        "approve",
        origin,
        next.op,
        "read",
        instruction,
        (answer) => {
          // Only an approval that was performed, or may have been, uses up
          // the hour's allowance: a refusal or a decline costs nothing.
          if (usesAllowance(answer))
            recordApproval(origin, { at: Date.now(), cents });
        },
      );
      return;
    }
    // accountAction is recreated each render and reads current state, so it
    // is deliberately not a dependency.
  }, [companies, instructions, busy]);

  const discover = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    return connectTo(companyUrl);
  };

  /**
   * Connects a Company: a card's, the bar's or the form's address. A
   * running conversation takes it as one more of its Companies; with none,
   * connecting starts one.
   */
  async function connectTo(url: string) {
    if (busy) return;
    if (current.current && !ended) return addCompany(url);
    setCompanyUrl(url);
    setDiscovering(true);
    setError("");
    setAddError("");
    setBarNote("");
    setFailedTrace([]);
    setMessages([]);
    setChatLog([]);
    setCompanies([]);
    setFormer([]);
    setLastTurn(undefined);
    setStartingDirect(undefined);
    try {
      // Connecting starts a new conversation, whatever this page showed.
      const response = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      if (response.ok) {
        current.current = undefined;
        adopt(response);
      }
      const data = await response.json();
      if (!response.ok) {
        setFailedTrace(data.trace ?? []);
        throw new Error(data.error ?? "Could not connect to the Company.");
      }
      if (current.current) await restore(current.current);
      setAddressOpen(false);
      setLastTurn(originOf(data.requestedUrl));
      options.onConnected?.();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Discovery failed. Try again.",
      );
    } finally {
      setDiscovering(false);
    }
  }

  /**
   * Adds a Company to the conversation, signed out, whatever the others
   * hold: a sign-in under way elsewhere goes on. A fourth is refused here,
   * before anything is sent, as the server would refuse it.
   */
  async function addCompany(url: string) {
    if (busy || ended || !current.current) return;
    setAddError("");
    setBarNote("");
    const origin = originOf(url.trim());
    const already = companies.find((c) => c.origin === origin);
    if (already) {
      setAddError(`This conversation is already connected to ${already.name}.`);
      return;
    }
    if (companies.length >= MAX_COMPANIES) {
      setAddError(
        `A conversation works with at most ${MAX_COMPANIES} companies. Remove one to connect another.`,
      );
      return;
    }
    setCompanyUrl(url);
    setDiscovering(true);
    try {
      const response = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...named() },
        body: JSON.stringify({ url: url.trim() }),
      });
      const moved = adopt(response);
      const data = await response.json();
      if (!response.ok) {
        if (data.code === "conversation_ended") return;
        setFailedTrace(data.trace ?? []);
        throw new Error(data.error ?? "Could not connect to the Company.");
      }
      setFailedTrace([]);
      // The conversation's Companies as the server now holds them; its
      // words stay as they are, unless the page was moved to another one.
      if (current.current) await restore(current.current, moved);
      setAddressOpen(false);
      setLastTurn(originOf(data.requestedUrl));
      options.onConnected?.();
    } catch (caught) {
      setAddError(
        caught instanceof Error && caught.message
          ? caught.message
          : "Discovery failed. Try again.",
      );
    } finally {
      setDiscovering(false);
    }
  }

  /** The Company the User is talking with directly, if any (§8.10). */
  const directWith = companies.find((c) => c.direct.direct);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!task.trim() || busy || ended || missing) return;
    const message = task.trim();
    setTask("");
    // §8.10: in a Direct Conversation, the User's words go to the Company.
    const action = directWith ? "say" : startingDirect ? "start" : undefined;
    const company =
      directWith?.origin ??
      startingDirect ??
      (target && companies.some((c) => c.origin === target)
        ? target
        : undefined);
    setTarget(undefined);
    const said: Message[] = [
      { role: "You", text: message, ...(action ? { direct: true } : {}) },
    ];
    setMessages((old) => [...old, ...said]);
    await post(
      { message, ...(action ? { direct: action } : {}), company },
      said,
    );
  }

  /**
   * A suggestion is one of demo mode's examples, and pressing it starts
   * that example: its words go at once, for the Company it was offered for.
   * What the message box holds stays there.
   */
  async function suggest(text: string, origin: string) {
    if (busy || ended || missing) return;
    const said: Message[] = [{ role: "You", text }];
    setMessages((old) => [...old, ...said]);
    await post({ message: text, company: origin }, said);
  }

  /** One of Iris's buttons: its answer goes as it came, its label is shown. */
  async function choose(choice: Choice) {
    if (busy || ended) return;
    const said: Message[] = [{ role: "You", text: choice.label }];
    setMessages((old) => [...old, ...said]);
    await post({ answer: choice.answer }, said);
  }

  /** §8.10: the User's own choices about a Direct Conversation. */
  async function directAction(
    action: "accept" | "decline" | "close",
    origin: string,
  ) {
    if (busy || ended) return;
    const label = {
      accept: "Talk to the Company directly",
      decline: "Not now",
      close: "Leave the direct conversation",
    }[action];
    // A button of the Direct Conversation leaves no line of the User's.
    await post({ message: label, direct: action, company: origin }, []);
  }

  async function post(
    request: {
      message?: string;
      answer?: Choice["answer"];
      direct?: DirectAction;
      company?: string | undefined;
    },
    said: Message[],
  ) {
    setSending(true);
    setError("");
    setBarNote("");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...named() },
        body: JSON.stringify({
          ...(request.message !== undefined
            ? { message: request.message }
            : {}),
          ...(request.answer ? { answer: request.answer } : {}),
          ...modelConfig,
          ...(request.direct ? { direct: request.direct } : {}),
          ...(request.company ? { company: request.company } : {}),
          // This page shows several Companies: the User's words may connect
          // or remove one, and a conversation may start with none.
          companies: true,
        }),
      });
      const moved = adopt(response);
      const data = (await response.json()) as ChatReply;
      if (data.code === "conversation_ended") {
        // Nothing was sent. The words go back to the box, and not into a
        // conversation that is over.
        if (said.length) {
          setMessages((old) => old.slice(0, -said.length));
          // Only what the User typed: never a button's label.
          if (request.message !== undefined) setTask(request.message);
        }
        return;
      }
      // The request was answered in another conversation than the one the
      // page showed: show that one as the server keeps it.
      if (moved && current.current) {
        await restore(current.current);
        return;
      }
      const from = data.from;
      // The Companies as they are now, and what the conversation still
      // shows, when the User's words or the turn changed them.
      takeConversation(data, said);
      if (!response.ok) {
        // What Iris did before the turn failed, such as the request the
        // Company refused: the Inspector shows it.
        addAnswerLines(data, from);
        if (from) {
          setLastTurn(from.origin);
          if (data.code === "account_unavailable") lostAt(from.origin, data);
        }
        setMessages((old) => [
          ...old,
          ...(data.before
            ? [{ role: "Iris" as const, text: data.before }]
            : []),
          {
            role: "Error",
            text:
              typeof data.error === "string" && data.error
                ? data.error
                : "Chat failed. Please try again.",
            ...(from ? { from } : {}),
          },
        ]);
        return;
      }
      setMessages((old) => [...old, ...turnMessages(data)]);
      addAnswerLines(data, from);
      if (from) {
        setLastTurn(from.origin);
        setCompanies((all) =>
          patchCompany(all, from.origin, (c) => {
            const next = afterTurn(c, data);
            // The turn got an answer though the access went during it.
            return Array.isArray(data.history) && !next.signedIn
              ? accessLost(next)
              : next;
          }),
        );
        setError(data.recovery?.error ?? "");
        // Nothing to talk from any more: the next message is for Iris.
        if (!data.conversation && startingDirect === from.origin)
          setStartingDirect(undefined);
      }
      if (request.direct === "start") setStartingDirect(undefined);
    } catch (caught) {
      setMessages((old) => [
        ...old,
        {
          role: "Error",
          text:
            caught instanceof Error && caught.message
              ? caught.message
              : "Chat failed.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  /** Puts the message that failed back in the composer and drops it and the error. */
  function retryMessage(index: number) {
    let from = index - 1;
    while (from >= 0 && messages[from]?.role !== "You") from--;
    const failed = messages[from];
    if (failed) setTask(failed.text);
    setMessages((old) =>
      old.filter((_, i) => i !== index && (!failed || i !== from)),
    );
  }
  const removeMessage = (index: number) =>
    setMessages((old) => old.filter((_, i) => i !== index));

  return {
    conversation,
    readOnly: !!ended,
    keptUntil: ended?.keptUntil,
    missing,
    /** The demo was reset under this page: its conversation has ended. */
    markEnded: () => {
      if (current.current) setEnded({});
    },
    companyUrl,
    setCompanyUrl,
    addressOpen,
    setAddressOpen,
    panel,
    setPanel,
    configureModel,
    companies,
    former,
    lastTurn,
    discovering,
    error,
    addError,
    setAddError,
    removeError,
    barNote,
    failedTrace,
    task,
    setTask,
    suggest,
    target,
    setTarget,
    messages,
    chatLog,
    sending,
    busy,
    /** The grant lets Iris propose changes there, not only read. */
    canWrite: mayChange,
    /** Change permission can still be asked for there. */
    moreAccess: (c: CompanyState) =>
      canRequestChanges(
        c.company ? companyProfile(c.company) : undefined,
        c.scopes,
      ),
    /** Use FDX or Use ESPI is on but this sign-in lacks its scopes. */
    extensionSignIn: (c: CompanyState) => {
      const extension = extensionOf(c);
      return (
        c.extensionOn &&
        !!extension &&
        c.signedIn &&
        missingExtensionScopes(
          c.company ? companyProfile(c.company) : undefined,
          c.scopes,
          extension,
        ).length > 0
      );
    },
    chooseExtension,
    /** The FDX consent or ESPI authorization to show and offer to revoke. */
    grantShown,
    revokeGrant,
    /** Statements to list and download, with Use FDX on and fdx:STATEMENTS. */
    statementsShown,
    listFdxStatements,
    downloadFdxStatement,
    accountAction,
    removeCompany,
    discover,
    connectTo,
    /** No model: the demo's keyword rules answer. */
    demo: modelConfig.provider === "demo",
    send,
    choose,
    directWith,
    startingDirect,
    setStartingDirect,
    directAction,
    retryMessage,
    removeMessage,
    instructions,
    setLimit,
    heldBack,
  };
}
export type Playground = ReturnType<typeof usePlayground>;
