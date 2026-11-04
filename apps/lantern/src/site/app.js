/**
 * Lantern Noodle Bar account page, browser side. Served as /site/app.js from
 * the generated `app-script.ts`; `pnpm site:script` regenerates it (dev,
 * build and deploy do). Plain JavaScript: it renders /site/state, edits an
 * order through /site/orders/:id, and never applies an agent's proposal.
 */
const account = document.querySelector(".account").dataset.account;
const fetch = (url, options = {}) =>
  window.fetch(url, {
    ...options,
    headers: { ...options.headers, "X-Lantern-Account": account },
  });
const $ = (id) => document.getElementById(id);
const money = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n / 100,
  );
const node = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
const states = {
  proposed: "Awaiting approval",
  succeeded: "Applied",
  expired: "Expired",
};
let snapshot = null;
const editing = new Map();

function orderEditor(order) {
  const form = node("form", undefined, "editor");
  form.dataset.version = String(order.version);
  const slotLabel = node("label", "Delivery slot");
  slotLabel.htmlFor = order.id + "-slot";
  const select = node("select");
  select.id = slotLabel.htmlFor;
  for (const s of snapshot.slots) {
    const option = node("option", s.label);
    option.value = s.id;
    if (s.id === order.slot.id) option.selected = true;
    select.append(option);
  }
  form.append(slotLabel, select);
  const grid = node("div", undefined, "quantities");
  for (const d of snapshot.menu) {
    const row = node("div", undefined, "quantity");
    const label = node("label", d.name);
    label.htmlFor = order.id + "-" + d.id;
    label.append(node("small", money(d.price_cents) + " · max 9", "notice"));
    const input = node("input");
    input.id = label.htmlFor;
    input.type = "number";
    input.min = "0";
    input.max = "9";
    input.step = "1";
    input.required = true;
    input.dataset.dish = d.id;
    input.value = String(
      order.items.find((i) => i.dish_id === d.id)?.quantity || 0,
    );
    row.append(label, input);
    grid.append(row);
  }
  form.append(grid);
  form.append(
    node(
      "p",
      "Saving replaces the dishes and slot of this order and makes any pending agent proposal for it stale. Zero removes a dish. Fictional: nothing is charged or delivered.",
      "notice",
    ),
  );
  const actions = node("div", undefined, "actions");
  const save = node("button", "Save order");
  save.type = "submit";
  const cancel = node("button", "Cancel", "secondary");
  cancel.type = "button";
  cancel.addEventListener("click", () => {
    editing.delete(order.id);
    render(snapshot);
  });
  actions.append(save, cancel);
  form.append(actions);
  const status = node("p", undefined, "notice");
  status.setAttribute("role", "status");
  form.append(status);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const buttons = [...form.querySelectorAll("button")];
    buttons.forEach((b) => (b.disabled = true));
    try {
      const lines = Object.fromEntries(
        [...form.querySelectorAll("[data-dish]")].map((i) => [
          i.dataset.dish,
          Number(i.value),
        ]),
      );
      const r = await fetch("/site/orders/" + encodeURIComponent(order.id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: Number(form.dataset.version),
          slot_id: select.value,
          lines,
        }),
        signal: AbortSignal.timeout(6000),
      });
      if (r.status === 403) {
        stopped = true;
        location.assign("/site/login");
        return;
      }
      if (r.status === 409) {
        status.textContent =
          "The order changed while you were editing. Nothing was saved. Cancel and open the editor again to see the current order.";
        await refresh();
        return;
      }
      if (!r.ok) {
        status.textContent =
          "Check the quantities (0 to 9, at least one dish) and the slot.";
        return;
      }
      editing.delete(order.id);
      flash = "Order saved. Any pending agent proposal for it is now stale.";
      await refresh(true);
    } catch {
      status.textContent =
        "We couldn’t confirm the save. Refresh before resending; your draft is kept.";
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  });
  return form;
}

let flash = "";
function render(data) {
  snapshot = data;
  $("current-account").textContent =
    "Fictional account: " + data.customer + " (" + data.account_id + ")";
  const list = $("order-list");
  list.replaceChildren();
  if (!data.orders.length)
    list.append(node("p", "No scheduled orders.", "notice"));
  for (const o of data.orders) {
    const article = node("article", undefined, "order");
    const head = node("div", undefined, "order-head");
    head.append(
      node("h3", o.id),
      node("span", o.slot.label + " · version " + o.version, "mono"),
    );
    article.append(head);
    const lines = node("div", undefined, "lines");
    for (const i of o.items) {
      const row = node("div", undefined, "line");
      row.append(
        node("span", i.quantity + " × " + i.name),
        node("span", money(i.line_total_cents), "mono"),
      );
      lines.append(row);
    }
    article.append(lines);
    const totals = node("div", undefined, "totals");
    for (const [label, value] of [
      ["Dishes", o.subtotal_cents],
      ["Delivery", o.delivery_cents],
      ["Total", o.total_cents],
    ]) {
      const row = node("div", undefined, label === "Total" ? "total" : "");
      row.append(node("span", label), node("span", money(value), "mono"));
      totals.append(row);
    }
    article.append(totals);
    article.append(
      node(
        "p",
        "Recipient: " +
          o.recipient +
          " · " +
          o.address +
          " · Simulated order, nothing charged or delivered.",
        "notice",
      ),
    );
    if (editing.has(o.id)) article.append(orderEditor(o));
    else {
      const edit = node("button", "Edit order", "secondary");
      edit.type = "button";
      edit.addEventListener("click", () => {
        editing.set(o.id, true);
        render(snapshot);
        article.querySelector("select")?.focus();
      });
      article.append(edit);
    }
    list.append(article);
  }
  const delivered = $("delivered-order");
  delivered.replaceChildren();
  if (data.delivered) {
    const d = data.delivered;
    const article = node("article", undefined, "order");
    const head = node("div", undefined, "order-head");
    head.append(
      node("h3", d.id),
      node("span", "Delivered " + d.delivered_at, "mono"),
    );
    article.append(head);
    const lines = node("div", undefined, "lines");
    for (const i of d.items) {
      const row = node("div", undefined, "line");
      row.append(
        node("span", i.quantity + " × " + i.name),
        node(
          "span",
          i.refunded_quantity
            ? "Refunded " +
                i.refunded_quantity +
                " · " +
                money(i.refunded_quantity * i.unit_price_cents)
            : money(i.quantity * i.unit_price_cents),
          "mono",
        ),
      );
      lines.append(row);
    }
    article.append(lines);
    article.append(
      node(
        "p",
        d.refunds.length
          ? "Refunds are made through Lantern's agent in a conversation. Simulated: no real money moved."
          : "Something missing? Ask your agent to tell Lantern; a refund needs your approval.",
        "notice",
      ),
    );
    delivered.append(article);
  }
  const activity = $("activity-list");
  activity.replaceChildren();
  if (!data.activity.length)
    activity.append(node("p", "No proposals yet.", "notice"));
  for (const a of data.activity) {
    const article = node("article", undefined, "activity");
    article.append(
      node("h3", states[a.state] || a.state),
      node("p", a.result || a.summary),
    );
    activity.append(article);
  }
}

let busy = false,
  last = "",
  stopped = false;
async function refresh(force) {
  if (busy || stopped) return;
  busy = true;
  $("refresh").disabled = true;
  try {
    const r = await fetch("/site/state", {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (r.status === 401) {
      stopped = true;
      location.assign("/site/login");
      return;
    }
    if (!r.ok) throw new Error();
    const data = await r.json(),
      signature = JSON.stringify(data);
    if (data.account_id !== account) {
      stopped = true;
      location.assign("/account");
      return;
    }
    if (signature !== last || force) {
      // Keep an open editor's draft; redraw everything else.
      if (!editing.size || force) render(data);
      else {
        snapshot = data;
        $("current-account").textContent =
          "Fictional account: " + data.customer + " (" + data.account_id + ")";
      }
      last = signature;
    }
    $("content").setAttribute("aria-busy", "false");
    $("status").className = "live";
    const text = flash || "Up to date · refreshes every 2 s";
    flash = "";
    if ($("status").textContent !== text) $("status").textContent = text;
    $("status").title =
      "Last checked: " + new Date().toLocaleTimeString("en-US");
  } catch {
    $("status").className = "error";
    $("status").textContent =
      "Couldn’t refresh. Showing the last view; press Refresh now to retry.";
  } finally {
    busy = false;
    $("refresh").disabled = false;
  }
}

$("load-access").addEventListener("click", async () => {
  const button = $("load-access");
  button.disabled = true;
  try {
    const r = await fetch("/site/access", {
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) throw Error();
    const data = await r.json();
    $("access-list").replaceChildren();
    if (!data.grants.length)
      $("access-list").append(node("p", "No active grants.", "notice"));
    for (const g of data.grants) {
      const row = node("article", undefined, "activity"),
        revoke = node("button", "Revoke this grant", "secondary");
      revoke.type = "button";
      row.append(
        node(
          "p",
          g.client +
            " · " +
            g.scopes +
            " · expires " +
            new Date(g.expires_at).toLocaleString("en-US"),
        ),
        revoke,
      );
      revoke.addEventListener("click", async () => {
        revoke.disabled = true;
        try {
          const result = await fetch(
            "/site/access/" + encodeURIComponent(g.id) + "/revoke",
            { method: "POST", signal: AbortSignal.timeout(6000) },
          );
          if (!result.ok) throw Error();
          row.replaceChildren(node("p", "Grant revoked."));
          $("access-status").textContent =
            "The agent can no longer use this grant.";
        } catch {
          revoke.disabled = false;
          $("access-status").textContent =
            "We couldn’t confirm the revocation. Check the grants before retrying.";
        }
      });
      $("access-list").append(row);
    }
  } catch {
    $("access-status").textContent =
      "Couldn’t load the grants. Sign in again if your session has expired.";
  } finally {
    button.disabled = false;
  }
});
$("refresh").addEventListener("click", () => refresh(true));
$("logout").addEventListener("click", async () => {
  try {
    const r = await fetch("/site/logout", { method: "POST" });
    if (!r.ok) throw new Error();
    stopped = true;
    location.assign("/site/login");
  } catch {
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
