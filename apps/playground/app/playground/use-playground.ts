/**
 * The playground's state and its three server calls: discovery, chat and
 * account actions (sign-in, sign-out, approve, decline, retry). It also
 * restores the current run on load and waits for a consent tab to finish.
 * Rendering lives in the components; nothing here touches the DOM except
 * the sign-in popup and the `?company=` query.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
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
} from "@/lib/account-permissions";
import type { ReviewOperation as Operation } from "@/lib/operation-presentation";
import { exampleUrl, historyToMessages, type Message } from "./companies";

export function usePlayground(options: { onConnected?: () => void } = {}) {
  const [companyUrl, setCompanyUrl] = useState(exampleUrl);
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
  const [chatTrace, setChatTrace] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [scopes, setScopes] = useState("");
  const [consentVersion, setConsentVersion] = useState(0);
  const [accountBusy, setAccountBusy] = useState(false);
  const [waitingSignIn, setWaitingSignIn] = useState(false);
  const [operations, setOperations] = useState<Operation[]>([]);
  const profile = result ? companyProfile(result) : undefined;
  // Scope meaning comes from the Company's own hints (0.3 §4.7).
  const canWrite = canChange(profile, scopes);
  const moreAccess = canRequestChanges(profile, scopes);
  const connected =
    !!result && companyUrl === result.requestedUrl.replace(/\/$/, "");
  const trace = result?.trace ?? failedTrace;
  const busy = sending || discovering || accountBusy;

  // Restore the current run, or take the Company named by the home page.
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/account")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        // A link from the home page (?company=) names the Company to try.
        const wanted = new URLSearchParams(window.location.search).get(
          "company",
        );
        if (wanted && /^https?:\/\/[^\s]{1,280}$/.test(wanted)) {
          if (
            data.company?.requestedUrl.replace(/\/$/, "") !==
            wanted.replace(/\/$/, "")
          ) {
            setCompanyUrl(wanted.replace(/\/$/, ""));
            return;
          }
        }
        if (!data.company) return;
        setResult(data.company);
        setCompanyUrl(data.company.requestedUrl.replace(/\/$/, ""));
        setSignedIn(!!data.signedIn);
        setScopes(data.scopes ?? "");
        if (data.recovery?.error) setError(data.recovery.error);
        setOperations(data.operations ?? []);
        setMessages(historyToMessages(data.history));
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
      void fetch("/api/account")
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          const outcome = consentOutcome(data, consentVersion);
          if (outcome === "completed") {
            setMessages(historyToMessages(data.history));
            setOperations(data.operations ?? []);
            setSignedIn(true);
            setScopes(data.scopes ?? "");
            setWaitingSignIn(false);
            setChatTrace((old) => [
              ...old,
              "Direct Sign-In completed · PKCE + issuer validation · DPoP account Session",
            ]);
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

  const replaceOperation = (operation: Operation) =>
    setOperations((old) =>
      old.map((item) =>
        item.operation_id === operation.operation_id ? operation : item,
      ),
    );

  async function accountAction(
    action: string,
    op?: Operation,
    access: "read" | "write" = "read",
  ) {
    if (busy) return;
    const popup =
      action === "signin" ? window.open("about:blank", "company-signin") : null;
    setAccountBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PAP-Company": result?.requestedUrl ?? companyUrl,
        },
        body: JSON.stringify({
          action,
          ...(action === "signin" ? { access } : {}),
          id: op?.operation_id,
          revision: op?.revision,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.code === "account_unavailable") {
          setSignedIn(false);
          setScopes("");
        }
        // New terms (Operations v2) or an unknown outcome: show current state.
        if (data.operation) replaceOperation(data.operation);
        if (data.code === "outcome_unknown" && op)
          replaceOperation({ ...op, state: "uncertain" });
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
      if (action === "signout") {
        setScopes("");
        setSignedIn(false);
        setOperations([]);
        setWaitingSignIn(false);
        setMessages([]);
        setChatTrace((old) => [
          ...old,
          "Account grant revoked · Session signed out",
        ]);
      }
      if (data.operation) {
        replaceOperation(data.operation);
        setChatTrace((old) => [
          ...old,
          `Operation ${data.operation.state} · revision ${data.operation.revision}`,
        ]);
      }
    } catch (caught) {
      popup?.close();
      setError(
        caught instanceof Error ? caught.message : "Account action failed.",
      );
    } finally {
      setAccountBusy(false);
    }
  }

  async function discover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setDiscovering(true);
    setError("");
    setResult(null);
    setFailedTrace([]);
    setMessages([]);
    setChatTrace([]);
    setSignedIn(false);
    setWaitingSignIn(false);
    setOperations([]);
    try {
      const response = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: companyUrl.trim() }),
      });
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
    if (!task.trim() || !connected || !result || busy) return;
    const message = task.trim();
    setTask("");
    setSending(true);
    setMessages((old) => [...old, { role: "You", text: message }]);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: result.requestedUrl,
          message,
          ...modelConfig,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
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
        }>
      ).map((entry) => ({
        role: "Company",
        author: entry.author,
        text: entry.text ?? "",
        ...(entry.data ? { data: entry.data } : {}),
        ...(entry.note ? { note: entry.note } : {}),
      }));
      setMessages((old) => [
        ...old,
        ...company,
        { role: data.mode === "demo" ? "Demo" : "Agent", text: data.text },
      ]);
      setChatTrace((old) => [...old, ...data.trace].slice(-30));
      setSignedIn(!!data.signedIn);
      setScopes(data.scopes ?? "");
      setError(data.recovery?.error ?? "");
      setOperations(data.operations ?? []);
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

  return {
    companyUrl,
    setCompanyUrl,
    configureModel,
    result,
    discovering,
    error,
    task,
    setTask,
    messages,
    chatTrace,
    sending,
    signedIn,
    scopes,
    canWrite,
    moreAccess,
    waitingSignIn,
    operations,
    connected,
    trace,
    busy,
    accountAction,
    discover,
    send,
  };
}
export type Playground = ReturnType<typeof usePlayground>;
