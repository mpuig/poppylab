/**
 * Juniper Market customer website, browser side. Served as /site/app.js by
 * `website.ts` from the generated `app-script.ts`; run `pnpm site:script`
 * after editing (the dev, build and deploy scripts do). Plain JavaScript on
 * purpose: no bundling, no framework, no inline HTML. Everything it shows
 * comes from /site/state; it never applies an agent's proposal itself.
 */
const fetch = (url, options = {}) =>
  window.fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      "X-Juniper-Account": document.body.dataset.account,
    },
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
function items(target, rows) {
  const el = $(target);
  el.replaceChildren();
  if (!rows.length) {
    el.append(node("p", "No products.", "empty"));
    return;
  }
  for (const p of rows) {
    const row = node("div", undefined, "line-item"),
      label = node("div");
    label.append(
      node("strong", p.name),
      node(
        "small",
        p.quantity + " × " + p.unit + " · " + money(p.price) + " / unit",
      ),
    );
    row.append(label, node("span", money(p.line_total_cents), "price"));
    el.append(row);
  }
}
function totals(target, data) {
  const dl = node("div", undefined, "totals");
  for (const [label, value] of [
    ["Products", data.subtotal_cents],
    ["Delivery", data.delivery_fee_cents],
    ["Total", data.total_cents],
  ]) {
    const line = node("div", undefined, label === "Total" ? "total" : "");
    line.append(node("span", label), node("span", money(value), "price"));
    dl.append(line);
  }
  $(target).replaceChildren(dl);
}
const days = { Tuesday: "Tuesday", Thursday: "Thursday", Saturday: "Saturday" };
const states = {
  proposed: "Awaiting approval",
  succeeded: "Applied",
  cancelled: "Declined",
  expired: "Expired",
  failed: "Not applied",
  in_progress: "In progress",
};
let currentProfile = null;
function renderServices(data) {
  currentProfile = { profile: data.profile, version: data.profile_version };
  if (!$("profile-form").dataset.saving) $("edit-profile").disabled = false;
  const select = $("case-order"),
    orderSignature = JSON.stringify(
      (data.orders || []).map((o) => [o.id, o.total_cents]),
    );
  if (select.dataset.orders !== orderSignature) {
    const previous = select.value;
    select.replaceChildren();
    const empty = node("option", "No related order");
    empty.value = "";
    select.append(empty);
    for (const o of data.orders || []) {
      const option = node("option", o.id + " · " + money(o.total_cents));
      option.value = o.id;
      select.append(option);
    }
    select.value = previous;
    select.dataset.orders = orderSignature;
  }
  $("profile-data").replaceChildren();
  for (const [label, key] of [
    ["Name", "name"],
    ["Test email", "email"],
    ["Fictional address", "address"],
  ]) {
    const row = node("div", undefined, "line-item");
    row.append(
      node("dt", label),
      node("dd", data.profile?.[key] || "Not available"),
    );
    $("profile-data").append(row);
  }
  $("invoice-list").replaceChildren();
  if (!data.invoices?.length)
    $("invoice-list").append(
      node(
        "p",
        "No documents yet. They are generated from your simulated orders.",
        "empty",
      ),
    );
  for (const i of data.invoices || []) {
    const row = node("article", undefined, "order");
    row.append(
      node("h3", i.id),
      node(
        "p",
        "Order " +
          i.order_id +
          " · " +
          money(i.total_cents) +
          " · Simulated, nothing charged",
      ),
    );
    $("invoice-list").append(row);
  }
  const expanded = new Set(
    [...document.querySelectorAll("#case-list details[open]")].map(
      (d) => d.dataset.caseId,
    ),
  );
  $("case-list").replaceChildren();
  if (!data.cases?.length)
    $("case-list").append(
      node(
        "p",
        "You have no support cases. You can read the FAQs or send a request.",
        "empty",
      ),
    );
  for (const c of data.cases || []) {
    const article = node("article", undefined, "activity"),
      details = node("details"),
      summary = node(
        "summary",
        c.subject + " · " + (c.status === "open" ? "Open" : "Closed"),
      );
    details.dataset.caseId = c.id;
    details.open = expanded.has(c.id);
    details.append(
      summary,
      node("p", c.id + " · version " + c.version, "notice"),
    );
    if (c.order_id) details.append(node("p", "Order: " + c.order_id));
    for (const m of c.messages) {
      const p = node("p", undefined, "support-message");
      p.append(
        node(
          "strong",
          m.actor === "customer" ? "Your message" : "Automatic test support",
        ),
        node("span", m.text),
      );
      details.append(p);
    }
    const button = node("button", "Add information", "secondary");
    button.type = "button";
    button.setAttribute("aria-label", "Add information: " + c.subject);
    button.addEventListener("click", () => {
      $("reply-id").value = c.id;
      $("reply-title").textContent = "Follow-up: " + c.subject;
      $("reply-form").hidden = false;
      $("reply-message").focus();
    });
    article.append(details, button);
    $("case-list").append(article);
  }
}
let shoppingSnapshot = null;
function render(data) {
  shoppingSnapshot = data;
  $("current-account").textContent =
    "Fictional account: " + data.customer + " (" + data.account_id + ")";
  for (const target of ["basket", "delivery"])
    if (!$(target + "-form").dataset.saving)
      $("edit-" + target).disabled = false;
  renderServices(data);
  items("basket-items", data.basket.items);
  totals("basket-total", data.basket);
  $("day").textContent =
    (data.delivery.items.length
      ? "Every "
      : "No products, so no simulated shipment. Day set: ") +
    (days[data.delivery.day] || data.delivery.day);
  items("delivery-items", data.delivery.items);
  totals("delivery-total", data.delivery);
  $("order-list").replaceChildren();
  if (!data.orders.length)
    $("order-list").append(
      node(
        "p",
        "No orders yet. A checkout you approve in Poppy will appear here.",
        "empty",
      ),
    );
  for (const o of data.orders) {
    const article = node("article", undefined, "order"),
      details = node("details"),
      summary = node("summary", o.id + " · " + money(o.total_cents));
    details.append(
      summary,
      node(
        "p",
        "Delivery: " +
          (days[o.delivery_day] || o.delivery_day) +
          " · Simulated order, nothing charged or shipped.",
      ),
    );
    details.append(
      node(
        "p",
        o.destination
          ? "Recipient: " + o.recipient + " · Address: " + o.destination
          : "No address recorded on this older order.",
      ),
    );
    for (const p of o.items)
      details.append(
        node(
          "p",
          p.quantity + " × " + p.name + " — " + money(p.line_total_cents),
        ),
      );
    article.append(details);
    $("order-list").append(article);
  }
  $("activity-list").replaceChildren();
  if (!data.activity.length)
    $("activity-list").append(node("p", "No proposals yet.", "empty"));
  for (const a of data.activity) {
    const article = node("article", undefined, "activity");
    article.append(
      node("h3", states[a.state] || a.state),
      node("p", a.result || a.summary),
    );
    $("activity-list").append(article);
  }
}
let busy = false,
  last = "",
  stopped = false;
async function refresh() {
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
    if (data.account_id !== document.body.dataset.account) {
      stopped = true;
      location.assign("/account");
      return;
    }
    if (signature !== last) {
      render(data);
      if (last) {
        $("content").classList.remove("updated");
        requestAnimationFrame(() => $("content").classList.add("updated"));
      }
      last = signature;
    }
    $("content").setAttribute("aria-busy", "false");
    $("status").className = "live";
    const connected = "Up to date · refreshes every 2 s";
    if ($("status").textContent !== connected)
      $("status").textContent = connected;
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
async function submitSupport(form, url, payload) {
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(6000),
    });
    if (r.status === 403) {
      stopped = true;
      location.assign("/site/login");
      return;
    }
    if (!r.ok) throw new Error();
    form.reset();
    if (form.id === "reply-form") form.hidden = true;
    $("support-status").textContent =
      "Request recorded. See the automatic test reply under Your requests.";
    await refresh();
  } catch {
    $("support-status").textContent =
      "We couldn’t confirm it was sent. Refresh Your requests before retrying, to avoid duplicates.";
  } finally {
    button.disabled = false;
  }
}
$("case-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const values = Object.fromEntries(new FormData(e.currentTarget));
  if (!values.order_id) delete values.order_id;
  submitSupport(e.currentTarget, "/site/cases", values);
});
$("reply-form").addEventListener("submit", (e) => {
  e.preventDefault();
  submitSupport(
    e.currentTarget,
    "/site/cases/" + encodeURIComponent($("reply-id").value) + "/messages",
    { message: $("reply-message").value },
  );
});
$("edit-profile").addEventListener("click", () => {
  if (!currentProfile) return;
  for (const key of ["name", "email", "address"])
    $("profile-" + key).value = currentProfile.profile[key];
  $("profile-version").value = currentProfile.version;
  $("profile-form").hidden = false;
  $("edit-profile").textContent = "Load the current data";
  $("profile-status").textContent = "";
  $("profile-name").focus();
});
$("cancel-profile").addEventListener("click", () => {
  $("profile-form").hidden = true;
  $("edit-profile").textContent = "Edit profile";
  $("edit-profile").focus();
});
$("profile-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget,
    buttons = [...form.querySelectorAll("button"), $("edit-profile")];
  form.dataset.saving = "true";
  buttons.forEach((b) => (b.disabled = true));
  try {
    const body = Object.fromEntries(new FormData(form));
    body.version = Number(body.version);
    const r = await fetch("/site/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(6000),
    });
    if (r.status === 403) {
      stopped = true;
      location.assign("/site/login");
      return;
    }
    if (r.status === 409) {
      $("profile-status").textContent =
        "The profile changed while you were editing. Nothing was saved. Press Load the current data to review it again.";
      await refresh();
      return;
    }
    if (!r.ok) {
      $("profile-status").textContent =
        "Check the fields: name, fictional address and an email ending in .invalid.";
      return;
    }
    $("profile-form").hidden = true;
    $("edit-profile").textContent = "Edit profile";
    $("profile-status").textContent =
      "Profile saved. Existing orders haven’t changed.";
    $("edit-profile").focus();
    await refresh();
  } catch {
    $("profile-status").textContent =
      "We couldn’t confirm the save. Refresh the account before resending; your draft is kept.";
  } finally {
    delete form.dataset.saving;
    buttons.forEach((b) => (b.disabled = false));
  }
});
for (const target of ["basket", "delivery"]) {
  const form = $(target + "-form"),
    edit = $("edit-" + target),
    cancel = $("cancel-" + target),
    status = $(target + "-status");
  const normal =
    target === "basket" ? "Edit basket" : "Edit recurring delivery";
  edit.addEventListener("click", () => {
    if (!shoppingSnapshot) return;
    const source = shoppingSnapshot[target];
    form.dataset.version = source.version;
    $(target + "-quantities").replaceChildren();
    for (const p of shoppingSnapshot.catalogue) {
      const row = node("div", undefined, "shopping-quantity"),
        label = node("label", p.name),
        input = node("input");
      label.htmlFor = target + "-" + p.id + "-quantity";
      label.append(
        node(
          "small",
          money(p.price) + " / " + p.unit + " · max " + p.stock,
          "notice",
        ),
      );
      input.id = label.htmlFor;
      input.type = "number";
      input.min = "0";
      input.max = String(p.stock);
      input.step = "1";
      input.required = true;
      input.dataset.product = p.id;
      input.value = String(
        source.items.find((i) => i.id === p.id)?.quantity || 0,
      );
      row.append(label, input);
      $(target + "-quantities").append(row);
    }
    if (target === "delivery") $("delivery-day").value = source.day;
    form.hidden = false;
    edit.textContent = "Load the current data";
    status.textContent = "";
    form.querySelector("select,input").focus();
  });
  cancel.addEventListener("click", () => {
    form.hidden = true;
    edit.textContent = normal;
    edit.focus();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const buttons = [...form.querySelectorAll("button"), edit];
    buttons.forEach((b) => (b.disabled = true));
    form.dataset.saving = "true";
    try {
      const body = {
        version: Number(form.dataset.version),
        items: Object.fromEntries(
          [...form.querySelectorAll("[data-product]")].map((i) => [
            i.dataset.product,
            Number(i.value),
          ]),
        ),
      };
      if (target === "delivery") body.day = $("delivery-day").value;
      const r = await fetch("/site/" + target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(6000),
      });
      if (r.status === 403) {
        stopped = true;
        location.assign("/site/login");
        return;
      }
      if (r.status === 409) {
        status.textContent =
          "The data changed while you were editing. Nothing was saved. Your draft is kept; press Load the current data to review it.";
        await refresh();
        return;
      }
      if (!r.ok) {
        status.textContent =
          "Check the whole-number quantities, their limits and the delivery day.";
        return;
      }
      form.hidden = true;
      edit.textContent = normal;
      status.textContent =
        target === "basket"
          ? "Basket saved. No order was created."
          : "Recurring delivery saved. Basket and existing orders unchanged.";
      edit.focus();
      await refresh();
    } catch {
      status.textContent =
        "We couldn’t confirm the save. Refresh the account before resending; your draft is kept.";
    } finally {
      delete form.dataset.saving;
      buttons.forEach((b) => (b.disabled = false));
    }
  });
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
      $("access-list").append(node("p", "No active grants."));
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
$("refresh").addEventListener("click", refresh);
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
