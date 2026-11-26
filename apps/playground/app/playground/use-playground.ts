/**
 * The playground's state and its three server calls: discovery, chat and
 * account actions (sign-in, sign-out, approve, decline, retry). Each
 * conversation has its own address, `/playground/<id>`: connecting starts
 * one, loading the address restores it (read-only once it has ended), and
 * a consent tab is waited for. Rendering lives in the components; nothing
 * here touches the DOM except the sign-in popup, the `?company=` query and
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
import type {
  DiscoveredCompany,
  DiscoveryTraceStep,
} from "@poppy-lab/pap-core";
import { initialModel, type ModelConfig } from "@/lib/model-options";
import {
  canChange,
  canRequestChanges,
  consentOutcome,
  missingExtensionScopes,
} from "@/lib/account-permissions";
import { domainExtension } from "@/lib/domain-extension";
import type { FdxConsentRecord } from "./fdx-consent";
import type { EspiAuthorizationRecord } from "./espi-authorization";
import type { FdxStatementAccount } from "./fdx-statements";
import type { ReviewOperation } from "@/lib/operation-presentation";
import { agentStep } from "@/lib/agent-steps";
import { logEntry, type ProtocolEntry } from "@/lib/protocol-log";
import {
  applyingLine,
  LOG_LIMITS,
  shownLines,
  statementLine,
} from "@/lib/inspector-log";
import {
  nextAutoApproval,
  usesAllowance,
  type ApprovalAnswer,
} from "@/lib/auto-approval";
import { directView } from "@/lib/direct-state";
import { withOperations } from "@/lib/operation-list";
import type { GuideOperation } from "@/lib/guide";
import {
  loadApprovals,
  loadInstruction,
  recordApproval,
  saveInstruction,
  type Instruction,
} from "@/lib/standing-instructions";
import {
  exampleUrl,
  historyToMessages,
  labCompany,
  type Message,
} from "./companies";

/**
 * A proposal as the page holds it: what its card shows, and why its terms
 * wait again after an approval, which the guide tells the visitor.
 */
type Operation = ReviewOperation & GuideOperation;

/** The conversation the address names, if it names one. */
const conversationInAddress = () =>
  /^\/playground\/([A-Za-z0-9_-]{16,64})\/?$/.exec(
    window.location.pathname,
  )?.[1];
const CONVERSATION = "X-Poppy-Conversation";

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
type GrantRecord = FdxConsentRecord | EspiAuthorizationRecord;
/** The grant id the server keeps for this sign-in, whichever the extension. */
const grantOf = (data: { fdxConsent?: string; espiAuthorization?: string }) =>
  data.espiAuthorization ?? data.fdxConsent;

export function usePlayground(options: { onConnected?: () => void } = {}) {
  const [companyUrl, setCompanyUrl] = useState(exampleUrl);
  // The conversation this page shows. The ref serves requests in flight.
  const [conversation, setConversation] = useState<string | undefined>();
  const current = useRef<string | undefined>(undefined);
  /** The `?company=` link was followed once (effects run twice in development). */
  const arrived = useRef(false);
  /** Ended conversations are read-only; `keptUntil` is when they go. */
  const [ended, setEnded] = useState<{ keptUntil?: number } | undefined>();
  /** The address names a conversation this browser can't open. */
  const [missing, setMissing] = useState(false);
  /** Takes the conversation the server names and puts it in the address. */
  const adopt = (response: Response) => {
    const id = response.headers.get(CONVERSATION);
    if (!id || id === current.current) return;
    current.current = id;
    setConversation(id);
    setEnded(undefined);
    setMissing(false);
    window.history.replaceState(null, "", `/playground/${id}`);
  };
  const named = (): Record<string, string> =>
    current.current ? { [CONVERSATION]: current.current } : {};
  const [modelConfig, setModelConfig] = useState<ModelConfig>(initialModel);
  const configureModel = useCallback(
    (config: ModelConfig) => setModelConfig(config),
    [],
  );
  const [result, setResult] = useState<DiscoveredCompany | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState("");
  const [failedTrace, setFailedTrace] = useState<DiscoveryTraceStep[]>([]);
  const [task, setTask] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  /**
   * The Inspector's "Session & API calls". The server keeps the same lines
   * with the conversation (`inspector-log.ts`), within the same count, so a
   * reload lists them again.
   */
  const [chatLog, setChatLog] = useState<ProtocolEntry[]>([]);
  const addTrace = (lines: string[]) =>
    setChatLog((old) =>
      [...old, ...lines.map((line) => logEntry(line))].slice(-LOG_LIMITS.lines),
    );
  const [sending, setSending] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [scopes, setScopes] = useState("");
  /**
   * Use FDX or Use ESPI for this conversation: the Company's domain
   * extension (poppylab.dev/fdx v1, poppylab.dev/espi v1), kept by the server.
   */
  const [extensionOn, setExtensionOn] = useState(false);
  /** Its grant's id for this sign-in (consent, authorization), as kept. */
  const [grantId, setGrantId] = useState<string | undefined>();
  /** Its record as the Company last returned it, read once per id. */
  const [grantRecord, setGrantRecord] = useState<GrantRecord | undefined>();
  /** The User revoked the grant (or found it had ended), and how. */
  const [grantRevoked, setGrantRevoked] = useState<
    "revoked" | "already_ended" | undefined
  >();
  /** The shared accounts' statements, once the User asked for them. */
  const [fdxStatements, setFdxStatements] = useState<
    FdxStatementAccount[] | undefined
  >();
  const [consentVersion, setConsentVersion] = useState(0);
  const [accountBusy, setAccountBusy] = useState(false);
  const [waitingSignIn, setWaitingSignIn] = useState(false);
  const [operations, setOperations] = useState<Operation[]>([]);
  /** §8.10: the User is talking with the Company themselves. */
  const [direct, setDirect] = useState(false);
  /** The Company's invitation to talk directly, with its reason ("" for none). */
  const [invitation, setInvitation] = useState<string | null>(null);
  /** There's a conversation with the Company's agent to talk from. */
  const [canTalkDirectly, setCanTalkDirectly] = useState(false);
  /** The next message starts a Direct Conversation. */
  const [startingDirect, setStartingDirect] = useState(false);
  /**
   * Takes what the server says about the Direct Conversation: in a chat
   * answer, on a reload, or nothing at all for a conversation just started.
   */
  const applyDirect = (state?: unknown) => {
    const view = directView(state);
    setDirect(view.direct);
    setInvitation(view.invitation);
    setCanTalkDirectly(view.canTalkDirectly);
  };
  const [instruction, setInstruction] = useState<Instruction | undefined>();
  const decided = useRef(new Set<string>());
  const profile = result ? companyProfile(result) : undefined;
  const origin = result ? new URL(result.requestedUrl).origin : "";
  // Scope meaning comes from the Company's own hints (§4.7).
  const canWrite = canChange(profile, scopes);
  const moreAccess = canRequestChanges(profile, scopes);
  /**
   * The domain extension the Company lists, valid, for Use FDX or Use ESPI
   * (profiles saved before may not say).
   */
  const extension = domainExtension(profile);
  /** It is on but this sign-in has none or only some of its scopes. */
  const extensionSignIn =
    extensionOn &&
    !!extension &&
    signedIn &&
    missingExtensionScopes(profile, scopes, extension).length > 0;
  const connected =
    !!result && companyUrl === result.requestedUrl.replace(/\/$/, "");
  const trace = result?.trace ?? failedTrace;
  const busy = sending || discovering || accountBusy;

  // Restore the conversation the address names, or start empty with the
  // Company a link named (?company=).
  useEffect(() => {
    let cancelled = false;
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
        }
      }
      return;
    }
    current.current = id;
    setConversation(id);
    void fetch(`/api/account?conversation=${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.missing || !data.company) {
          current.current = undefined;
          setConversation(undefined);
          setMissing(true);
          return;
        }
        if (data.readOnly) setEnded({ keptUntil: data.keptUntil });
        setResult(data.company);
        setCompanyUrl(data.company.requestedUrl.replace(/\/$/, ""));
        setSignedIn(!!data.signedIn);
        setScopes(data.scopes ?? "");
        const listed = domainExtension(companyProfile(data.company));
        setExtensionOn(!!(listed && data[listed.key]));
        setGrantId(grantOf(data));
        if (data.recovery?.error) setError(data.recovery.error);
        setOperations(data.operations ?? []);
        // §8.10: an open Direct Conversation is still open after a reload,
        // so the next message goes to the Company and not to Iris.
        applyDirect(data.directConversation);
        setMessages(historyToMessages(data.history));
        setChatLog(shownLines(data.log));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // While a consent tab is open, poll until it completes or is declined.
  useEffect(() => {
    if (!waitingSignIn) return;
    let cancelled = false;
    const interval = setInterval(() => {
      if (!current.current) return;
      void fetch(`/api/account?conversation=${current.current}`)
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          const outcome = consentOutcome(data, consentVersion);
          if (outcome === "completed") {
            setMessages(historyToMessages(data.history));
            setOperations(data.operations ?? []);
            setSignedIn(true);
            setScopes(data.scopes ?? "");
            // A sign-in as another account drops the conversation and the
            // Direct Conversation in it: the page must not stay in one.
            applyDirect(data.directConversation);
            setGrantId(grantOf(data));
            setGrantRevoked(undefined);
            setWaitingSignIn(false);
            // The lines follow the conversation: those written before any
            // account stay, then the server's line for this sign-in.
            setChatLog(shownLines(data.log));
          } else if (outcome === "not_completed") {
            setWaitingSignIn(false);
            setError(
              "Consent was not completed. Your previous access has not changed. You can try again.",
            );
          }
        })
        .catch(() => {});
    }, 2000);
    const timeout = setTimeout(() => {
      setWaitingSignIn(false);
      setError(
        "No consent completion was received. Reload to check account status before trying again.",
      );
    }, 300000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [waitingSignIn, consentVersion]);

  /** Shows the operations an answer carries, as the server now holds them. */
  const showOperations = (...answered: Array<Operation | undefined>) =>
    setOperations((old) => withOperations(old, ...answered));

  /** What the page shows once the run is signed out (sign-out, revocation). */
  function signedOutHere() {
    setScopes("");
    setSignedIn(false);
    setOperations([]);
    setWaitingSignIn(false);
    setMessages([]);
    setGrantId(undefined);
    setGrantRecord(undefined);
    setFdxStatements(undefined);
    // Signing out drops Iris's conversation with the Company's agent,
    // and the Direct Conversation with it.
    applyDirect();
    setStartingDirect(false);
  }

  async function accountAction(
    action: string,
    op?: Operation,
    access: "read" | "write" = "read",
    /** An agent approval: the User's standing instruction, rechecked server-side. */
    byInstruction?: Instruction,
    /** Told how the route answered, if the request was sent at all. */
    answered?: (answer: ApprovalAnswer) => void,
  ) {
    if (busy || ended) return;
    const popup =
      action === "signin" ? window.open("about:blank", "company-signin") : null;
    setAccountBusy(true);
    setError("");
    let answer: ApprovalAnswer = "lost";
    try {
      const response = await fetch("/api/account", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PAP-Company": result?.requestedUrl ?? companyUrl,
          ...named(),
        },
        body: JSON.stringify({
          action,
          ...(action === "signin" ? { access } : {}),
          id: op?.operation_id,
          revision: op?.revision,
          ...(byInstruction ? { instruction: byInstruction } : {}),
        }),
      });
      adopt(response);
      const data = await response.json();
      answer = { status: response.status, operation: data.operation };
      // The route's lines for the log: how an approval went, a sign-out.
      addTrace(data.trace ?? []);
      if (!response.ok) {
        if (data.code === "account_unavailable") {
          setSignedIn(false);
          setScopes("");
        }
        // New terms (Operations v3) or an unknown outcome: show current state.
        // New terms under another ID come with the operation they replace.
        showOperations(data.replaced, data.operation);
        if (data.code === "outcome_unknown" && op)
          showOperations({ ...op, state: "uncertain" });
        // A refusal the operation carries is on its card, where it stays
        // until the operation changes: not above the transcript as well.
        if (data.error && data.operation?.result?.summary === data.error)
          return;
        throw new Error(data.error);
      }
      if (data.url) {
        setConsentVersion(data.consentVersion ?? 0);
        if (popup) {
          popup.opener = null;
          popup.location.href = data.url;
          setWaitingSignIn(true);
        } else
          throw new Error(
            "Allow popups for this site, then try the sign-in or permission request again.",
          );
      }
      if (action === "signout") signedOutHere();
      if (data.operation) showOperations(data.operation);
    } catch (caught) {
      popup?.close();
      setError(
        caught instanceof Error ? caught.message : "Account action failed.",
      );
    } finally {
      // Before the page is idle again, so the next decision already sees it.
      answered?.(answer);
      setAccountBusy(false);
    }
  }

  /**
   * Use FDX or Use ESPI on or off for this conversation. The server starts
   * a new Session, whose declarations then say so (§3.4).
   */
  async function chooseExtension(enabled: boolean) {
    if (busy || ended || !extension) return;
    const { key, label } = extension;
    setAccountBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PAP-Company": result?.requestedUrl ?? companyUrl,
          ...named(),
        },
        body: JSON.stringify({ action: key, enabled }),
      });
      adopt(response);
      const data = await response.json();
      addTrace(data.trace ?? []);
      if (!response.ok) throw new Error(data.error);
      setExtensionOn(!!data[key]);
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

  /** A grant action of the User's: read or revoke the consent or authorization. */
  const grantCall = async (action: string) => {
    const response = await fetch("/api/account", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PAP-Company": result?.requestedUrl ?? companyUrl,
        ...named(),
      },
      body: JSON.stringify({ action }),
    });
    adopt(response);
    return { response, data: await response.json() };
  };

  // The grant's status and what it shares, read once for each id.
  const grantShown = extensionOn && signedIn && !!grantId && !!extension;
  const grants = extension ? GRANTS[extension.key] : undefined;
  /** The grant id whose record was asked for: each is read once. */
  const grantRead = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      !grantShown ||
      !grants ||
      busy ||
      ended ||
      grantRead.current === grantId
    )
      return;
    const id = grantId!;
    grantRead.current = id;
    setAccountBusy(true);
    void grantCall(grants.read)
      .then(({ response, data }) => {
        addTrace(data.trace ?? []);
        if (data.code === "account_unavailable") {
          setSignedIn(false);
          setScopes("");
          setError(data.error ?? "");
        }
        // A record the Company didn't return shows the id alone.
        const record = data[grants.field];
        setGrantRecord(
          response.ok && record?.id === id ? record : { id, unavailable: true },
        );
      })
      .catch(() => setGrantRecord({ id, unavailable: true }))
      .finally(() => setAccountBusy(false));
    // grantCall is recreated each render and reads current state.
  }, [grantShown, grantId, busy, ended]);

  /**
   * The User revokes the FDX consent or the ESPI authorization. The
   * Company ends the grant and its tokens, so the page signs out as
   * sign-out does; Iris never does this.
   */
  async function revokeGrant() {
    if (busy || ended || !grantShown || !grants) return;
    setAccountBusy(true);
    setError("");
    try {
      const { response, data } = await grantCall(grants.revoke);
      addTrace(data.trace ?? []);
      if (data.code === "account_unavailable") {
        setSignedIn(false);
        setScopes("");
      }
      if (!response.ok) throw new Error(data.error);
      signedOutHere();
      setGrantRevoked(
        data.revoked === "already_ended" ? "already_ended" : "revoked",
      );
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

  // A list read under another consent may name accounts no longer shared.
  useEffect(() => setFdxStatements(undefined), [grantId]);
  /** Statements need their data cluster in this sign-in, with Use FDX on. */
  const fdxStatementsShown =
    grantShown &&
    extension?.key === "fdx" &&
    scopes.split(" ").includes("fdx:STATEMENTS");
  /** Lists the shared accounts' statements (poppylab.dev/fdx v1). */
  async function listFdxStatements() {
    if (busy || ended || !fdxStatementsShown) return;
    setAccountBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PAP-Company": result?.requestedUrl ?? companyUrl,
          ...named(),
        },
        body: JSON.stringify({ action: "fdx_statements" }),
      });
      adopt(response);
      const data = await response.json();
      addTrace(data.trace ?? []);
      if (!response.ok || !Array.isArray(data.accounts))
        throw new Error(data.error);
      setFdxStatements(data.accounts);
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
  async function downloadFdxStatement(accountId: string, statementId: string) {
    if (busy || ended || !fdxStatementsShown) return;
    setAccountBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PAP-Company": result?.requestedUrl ?? companyUrl,
          ...named(),
        },
        body: JSON.stringify({
          action: "fdx_statement",
          accountId,
          statementId,
        }),
      });
      adopt(response);
      if (
        !response.ok ||
        response.headers.get("content-type") !== "application/pdf"
      ) {
        const data = await response.json().catch(() => ({}));
        addTrace(data.trace ?? []);
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
      addTrace([statementLine(statementId, file.size)]);
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

  // The User's standing instruction for this Company, if they wrote one.
  useEffect(() => {
    setInstruction(origin ? loadInstruction(origin) : undefined);
  }, [origin]);
  function setLimit(next: Instruction | null) {
    if (!origin) return;
    saveInstruction(origin, next);
    setInstruction(next ?? undefined);
  }

  /**
   * The revisions the hour's allowance left to the User, with the reason,
   * for their cards: a revision is looked at once, so it keeps waiting even
   * when the hour has passed.
   */
  const [heldBack, setHeldBack] = useState<Record<string, string>>({});
  // A fixed check against the exact terms; each revision is tried once.
  // Anything it does not cover stays for the User in the Needs you panel,
  // where its card says why (`leftToUser`).
  useEffect(() => {
    const next = nextAutoApproval({
      operations,
      instruction,
      signedIn,
      busy,
      decided: decided.current,
      recent: loadApprovals(origin),
    });
    if (!next) return;
    if (next.kind === "limit") {
      const { op, reason } = next;
      setHeldBack((old) => ({
        ...old,
        [`${op.operation_id}:${op.revision}`]: reason,
      }));
      addTrace([
        `Standing instruction not applied · ${next.reason}; waiting for you`,
      ]);
      return;
    }
    // The next line of the log says how the Company answered. The server
    // keeps this one in the same words when its own check agrees.
    addTrace([applyingLine(next.covered)]);
    const { cents } = next;
    void accountAction("approve", next.op, "read", instruction, (answer) => {
      // Only an approval that was performed, or may have been, uses up the
      // hour's allowance: a refusal or a Company's decline costs nothing.
      if (usesAllowance(answer))
        recordApproval(origin, { at: Date.now(), cents });
    });
    // accountAction is recreated each render and reads current state, so it
    // is deliberately not a dependency.
  }, [operations, instruction, signedIn, busy, origin]);

  const discover = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    return connectTo(companyUrl);
  };
  /** Connects to a Company: the form's address, or a card's. */
  async function connectTo(url: string) {
    if (busy) return;
    setCompanyUrl(url);
    setDiscovering(true);
    setError("");
    setResult(null);
    setFailedTrace([]);
    setMessages([]);
    setChatLog([]);
    setSignedIn(false);
    setWaitingSignIn(false);
    setOperations([]);
    // Use FDX is off in every new conversation.
    setExtensionOn(false);
    setGrantId(undefined);
    setGrantRecord(undefined);
    setGrantRevoked(undefined);
    setFdxStatements(undefined);
    // The new conversation has no Direct Conversation, whatever the last had.
    applyDirect();
    setStartingDirect(false);
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
      setResult(data as DiscoveredCompany);
      setCompanyUrl(
        (data as DiscoveredCompany).requestedUrl.replace(/\/$/, ""),
      );
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

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!task.trim() || !connected || !result || busy || ended) return;
    const message = task.trim();
    setTask("");
    // §8.10: in a Direct Conversation, the User's words go to the Company.
    const action = direct ? "say" : startingDirect ? "start" : undefined;
    setMessages((old) => [
      ...old,
      { role: "You", text: message, ...(action ? { direct: true } : {}) },
    ]);
    await post(message, action);
  }

  /** §8.10: the User's own choices about a Direct Conversation. */
  async function directAction(action: "accept" | "decline" | "close") {
    if (!connected || !result || busy || ended) return;
    const label = {
      accept: "Talk to the Company directly",
      decline: "Not now",
      close: "Leave the direct conversation",
    }[action];
    await post(label, action);
  }

  async function post(
    message: string,
    action?: "say" | "start" | "accept" | "decline" | "close",
  ) {
    if (!result) return;
    setSending(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...named() },
        body: JSON.stringify({
          url: result.requestedUrl,
          message,
          ...modelConfig,
          ...(action ? { direct: action } : {}),
        }),
      });
      adopt(response);
      const data = await response.json();
      if (!response.ok) {
        // What Iris did before the turn failed, such as the request the
        // Company refused: the Inspector shows it.
        addTrace(data.trace ?? []);
        if (data.code === "account_unavailable") {
          setSignedIn(false);
          setScopes("");
        }
        throw new Error(data.error ?? "Chat failed. Please try again.");
      }
      // What the Company's own agent said this turn comes before Iris's answer.
      const company: Message[] = (
        (data.company ?? []) as Array<{
          author: string;
          text?: string;
          data?: string;
          note?: string;
          direct?: boolean;
        }>
      ).map((entry) => ({
        role: "Company",
        author: entry.author,
        text: entry.text ?? "",
        ...(entry.data ? { data: entry.data } : {}),
        ...(entry.note ? { note: entry.note } : {}),
        ...(entry.direct ? { direct: true } : {}),
      }));
      setMessages((old) => [
        ...old,
        ...company,
        // In a Direct Conversation Iris says nothing unless something changed.
        ...(data.text
          ? [
              {
                role: (data.mode === "demo"
                  ? "Demo"
                  : "Agent") as Message["role"],
                text: data.text as string,
                // Demo mode: the Company's exact answer, behind "Data".
                ...(typeof data.data === "string" ? { data: data.data } : {}),
                steps: ((data.trace ?? []) as string[]).map((line) =>
                  agentStep(logEntry(line)),
                ),
              },
            ]
          : []),
      ]);
      addTrace(data.trace);
      setSignedIn(!!data.signedIn);
      setScopes(data.scopes ?? "");
      setError(data.recovery?.error ?? "");
      setOperations(data.operations ?? []);
      applyDirect(data);
      if (action === "start") setStartingDirect(false);
    } catch (caught) {
      setMessages((old) => [
        ...old,
        {
          role: "Error",
          text: caught instanceof Error ? caught.message : "Chat failed.",
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
    configureModel,
    result,
    discovering,
    error,
    task,
    setTask,
    messages,
    chatLog,
    sending,
    signedIn,
    scopes,
    canWrite,
    moreAccess,
    /** The Company's domain extension, for Use FDX or Use ESPI. */
    extension,
    extensionOn,
    extensionSignIn,
    chooseExtension,
    /**
     * The FDX consent or ESPI authorization to show and offer to revoke,
     * with its record once read.
     */
    grant: grantShown ? grantId : undefined,
    grantRecord: grantRecord?.id === grantId ? grantRecord : undefined,
    grantRevoked,
    revokeGrant,
    /** Statements to list and download, with Use FDX on and fdx:STATEMENTS. */
    fdxStatementsShown,
    fdxStatements: fdxStatementsShown ? fdxStatements : undefined,
    listFdxStatements,
    downloadFdxStatement,
    waitingSignIn,
    operations,
    connected,
    trace,
    busy,
    accountAction,
    discover,
    connectTo,
    /** No model: the demo's keyword rules answer. */
    demo: modelConfig.provider === "demo",
    send,
    direct,
    invitation,
    canTalkDirectly,
    startingDirect,
    setStartingDirect,
    directAction,
    retryMessage,
    removeMessage,
    instruction,
    setLimit,
    heldBack,
  };
}
export type Playground = ReturnType<typeof usePlayground>;
