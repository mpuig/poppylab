/** Fernwick fictional customer portal browser script. */
const account = document.querySelector(".account").dataset.account;
const $ = (id) => document.getElementById(id);
const request = (url, options = {}) =>
  window.fetch(url, {
    ...options,
    headers: { ...options.headers, "X-Fernwick-Account": account },
  });
const money = (cents) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
const plans = { flat: "Flat rate", "time-of-use": "Time of use" };
const month = (id) =>
  new Date(id + "-01T00:00:00Z").toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const day = (id) =>
  new Date(id + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const row = (title, amount, detail) => {
  const article = node("article", undefined, "data-row");
  const header = node("header");
  header.append(node("h3", title), node("span", amount, "num"));
  article.append(header, node("p", detail));
  return article;
};
const states = {
  proposed: "Awaiting approval",
  succeeded: "Done once",
  expired: "Expired without change",
  declined: "Not applied",
  refused: "Not applied",
};
/** One row of agent activity: a state tag and time, what was proposed, the result. */
const tones = { proposed: "pending", succeeded: "done", expired: "muted" };
function record(item, label) {
  const row = node("li", undefined, "record");
  row.dataset.tone = tones[item.state] || "muted";
  const head = node("div", undefined, "record-head");
  head.append(node("span", label, "record-tag"));
  // When it was applied, refused or ran out. A proposal that waits has
  // no time yet.
  if (item.when && item.state !== "proposed") {
    const time = node("time", item.when, "record-when");
    time.dateTime = item.at;
    head.append(time);
  }
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
/** Meter names by ID, to name a grant's meters without their IDs. */
let labels = {};
function render(data) {
  labels = Object.fromEntries(data.meters.map((m) => [m.id, m.label]));
  $("current-account").textContent =
    "Signed in as " +
    data.customer.name +
    ", a test customer · " +
    data.customer.address;
  $("meters").replaceChildren(
    ...data.meters.map((meter) =>
      row(
        meter.label,
        meter.month_kwh + " kWh",
        plans[meter.plan] +
          (meter.scheduled
            ? " · switching to " +
              plans[meter.scheduled.plan] +
              " on " +
              day(meter.scheduled.effective_date)
            : "") +
          (meter.month_sent_kwh
            ? " · " + meter.month_sent_kwh + " kWh sent to the grid"
            : "") +
          " · energy so far " +
          money(meter.month_energy_cents),
      ),
    ),
  );
  $("days").replaceChildren(
    ...data.meters.flatMap((meter) =>
      meter.days.map((item) =>
        row(day(item.day), item.kwh + " kWh", meter.label),
      ),
    ),
  );
  $("bills").replaceChildren(
    ...data.meters.flatMap((meter) =>
      meter.bills.map((bill) =>
        row(
          meter.label + " · " + month(bill.month),
          money(bill.total_cents),
          bill.kwh + " kWh · " + plans[bill.plan],
        ),
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
                (grant.resources && grant.resources.length
                  ? " · " +
                    grant.resources
                      .map((id) => labels[id] || "a meter")
                      .join(", ")
                  : "") +
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
