/** Harborline fictional customer portal browser script. */
const account = document.querySelector(".account").dataset.account;
const $ = (id) => document.getElementById(id);
const request = (url, options = {}) =>
  window.fetch(url, {
    ...options,
    headers: { ...options.headers, "X-Harborline-Account": account },
  });
const money = (cents) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const row = (title, amount, detail) => {
  const article = node("article", undefined, "data-row");
  const header = node("header");
  header.append(node("h3", title), node("span", amount, "amount"));
  article.append(header, node("p", detail));
  return article;
};
const states = {
  proposed: "Awaiting approval",
  succeeded: "Applied once",
  expired: "Expired without change",
};
/** One row of agent activity: a state tag, what was proposed, the result. */
const tones = { proposed: "pending", succeeded: "done", expired: "muted" };
function record(item, label) {
  const row = node("li", undefined, "record");
  row.dataset.tone = tones[item.state] || "muted";
  const head = node("div", undefined, "record-head");
  head.append(node("span", label, "record-tag"));
  row.append(head, node("p", item.summary || item.result, "record-title"));
  if (item.result && item.summary && item.result !== item.summary)
    row.append(node("p", item.result, "record-body"));
  // Who approved it, as your agent told us (Operations v3 §6).
  if (item.approver)
    row.append(
      node(
        "p",
        item.approver === "agent"
          ? "Approved by your agent, on a standing instruction you gave it"
          : "Approved by you, in your agent",
        "record-meta",
      ),
    );
  return row;
}
function render(data) {
  $("current-account").textContent =
    "Signed in as " +
    data.customer.name +
    ", a test customer · " +
    data.customer.email;
  $("accounts").replaceChildren(
    ...data.accounts.map((item) =>
      row(
        item.name,
        money(item.available_cents),
        item.type +
          " · current " +
          money(item.balance_cents) +
          " · " +
          item.status,
      ),
    ),
  );
  $("transactions").replaceChildren(
    ...data.transactions.map((item) =>
      row(
        item.description,
        money(item.amount_cents),
        item.category +
          " · " +
          item.status +
          " · " +
          new Date(item.occurred_at).toLocaleDateString("en-US", {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
      ),
    ),
  );
  $("cards").replaceChildren(
    ...data.cards.map((item) =>
      row(
        item.label + " · " + item.last4,
        item.status,
        "Linked to " +
          (data.accounts.find((account) => account.id === item.account_id)
            ?.name ?? item.account_id) +
          " · daily limit " +
          money(item.daily_limit_cents) +
          " · spent today " +
          money(item.spent_today_cents),
      ),
    ),
  );
  $("recipients").replaceChildren(
    ...data.recipients.map((item) =>
      row(
        item.name,
        item.status,
        item.bank_label +
          " · account ending " +
          item.account_last4 +
          " · payment limit " +
          money(item.payment_limit_cents),
      ),
    ),
  );
  $("budgets").replaceChildren(
    ...data.budgets.map((item) =>
      row(
        item.name,
        money(item.spent_cents) + " / " + money(item.limit_cents),
        item.month +
          " · " +
          item.category +
          " · remaining " +
          money(item.limit_cents - item.spent_cents),
      ),
    ),
  );
  const list = node("ol", undefined, "records");
  for (const item of data.activity)
    list.append(record(item, states[item.state] || item.state));
  $("activity").replaceChildren(
    data.activity.length ? list : node("p", "No agent proposals yet.", "fine"),
  );
}
let busy = false;
let stopped = false;
let last = "";
async function refresh(force) {
  if (busy || stopped) return;
  busy = true;
  $("refresh").disabled = true;
  try {
    const response = await request("/site/state", {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (response.status === 401) {
      stopped = true;
      location.assign("/site/login");
      return;
    }
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (data.account_id !== account) {
      stopped = true;
      location.assign("/account");
      return;
    }
    const signature = JSON.stringify(data);
    if (signature !== last || force) render(data);
    last = signature;
    $("content").setAttribute("aria-busy", "false");
    $("status").className = "live";
    $("status").textContent = "Up to date · refreshes every 2 seconds";
    $("status").title =
      "Last checked " + new Date().toLocaleTimeString("en-US");
  } catch {
    $("status").className = "error";
    $("status").textContent =
      "Couldn’t refresh. The last view stays on screen; try Refresh now.";
  } finally {
    busy = false;
    $("refresh").disabled = false;
  }
}
$("load-access").addEventListener("click", async () => {
  const button = $("load-access");
  button.disabled = true;
  try {
    const response = await request("/site/access", {
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) throw new Error();
    const data = await response.json();
    const rows = data.grants.length
      ? data.grants.map((grant) => {
          const article = node("article", undefined, "activity");
          const revoke = node("button", "Disconnect", "secondary");
          revoke.type = "button";
          article.append(
            node(
              "p",
              grant.client +
                " · " +
                grant.scopes +
                " · expires " +
                new Date(grant.expires_at).toLocaleString("en-US"),
            ),
            revoke,
          );
          revoke.addEventListener("click", async () => {
            revoke.disabled = true;
            try {
              const result = await request(
                "/site/access/" + encodeURIComponent(grant.id) + "/revoke",
                { method: "POST", signal: AbortSignal.timeout(6000) },
              );
              if (!result.ok) throw new Error();
              article.replaceChildren(node("p", "Disconnected."));
              $("access-status").textContent =
                "That agent can no longer reach your account.";
            } catch {
              revoke.disabled = false;
              $("access-status").textContent =
                "We couldn’t confirm it. Reload the list before trying again.";
            }
          });
          return article;
        })
      : [node("p", "No agents connected.", "fine")];
    $("access").replaceChildren(...rows);
  } catch {
    $("access-status").textContent =
      "Couldn’t load connected agents. The portal session may have expired.";
  } finally {
    button.disabled = false;
  }
});
$("refresh").addEventListener("click", () => refresh(true));
$("logout").addEventListener("click", async () => {
  try {
    const response = await request("/site/logout", { method: "POST" });
    if (!response.ok) throw new Error();
    stopped = true;
    location.assign("/site/login");
  } catch {
    $("status").className = "error";
    $("status").textContent = "Couldn’t log out. Try again.";
  }
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});
setInterval(() => {
  if (!document.hidden) refresh();
}, 2000);
refresh();
