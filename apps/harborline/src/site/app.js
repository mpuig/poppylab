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
function render(data) {
  $("current-account").textContent =
    "Fictional persona: " +
    data.customer.name +
    " (" +
    data.account_id +
    ") · " +
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
          item.status +
          " · version " +
          item.version,
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
          new Date(item.occurred_at).toLocaleString("en-US") +
          " · version " +
          item.version,
      ),
    ),
  );
  $("cards").replaceChildren(
    ...data.cards.map((item) =>
      row(
        item.label + " · " + item.last4,
        item.status,
        "Linked " +
          item.account_id +
          " · daily limit " +
          money(item.daily_limit_cents) +
          " · spent today " +
          money(item.spent_today_cents) +
          " · version " +
          item.version,
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
          money(item.limit_cents - item.spent_cents) +
          " · version " +
          item.version,
      ),
    ),
  );
  const activity = data.activity.length
    ? data.activity.map((item) => {
        const article = node("article", undefined, "activity");
        article.append(
          node("strong", states[item.state] || item.state),
          node("p", item.result || item.summary),
        );
        return article;
      })
    : [node("p", "No agent proposals yet.", "fine")];
  $("activity").replaceChildren(...activity);
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
      "Couldn’t refresh. The last fictional view remains visible; try Refresh now.";
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
          const revoke = node("button", "Revoke grant", "secondary");
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
              article.replaceChildren(node("p", "Grant revoked."));
              $("access-status").textContent =
                "The agent can no longer use that grant.";
            } catch {
              revoke.disabled = false;
              $("access-status").textContent =
                "Revocation could not be confirmed. Reload grants before retrying.";
            }
          });
          return article;
        })
      : [node("p", "No active grants.", "fine")];
    $("access").replaceChildren(...rows);
  } catch {
    $("access-status").textContent =
      "Couldn’t load grants. The portal session may have expired.";
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
