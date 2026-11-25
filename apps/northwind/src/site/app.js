/** Northwind Air account page. Plain browser JavaScript, generated into app-script.ts. */
const account = document.querySelector(".account").dataset.account;
const $ = (id) => document.getElementById(id);
const request = (url, options = {}) =>
  window.fetch(url, {
    ...options,
    headers: { ...options.headers, "X-Northwind-Account": account },
  });
const money = (cents) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
const node = (tag, text, cls) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (cls) element.className = cls;
  return element;
};
const activityNames = {
  proposed: "Awaiting approval",
  succeeded: "Applied",
  expired: "Expired",
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
/** Airport local time, as printed on a ticket: the ISO string's own clock. */
const localTime = (departure, arrival) =>
  new Date(departure.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }) +
  " · " +
  departure.slice(11, 16) +
  (arrival ? " → " + arrival.slice(11, 16) : "");

function render(data) {
  $("current-account").textContent =
    "Signed in as " + data.customer + ", a test passenger.";
  const trips = $("trip-list");
  trips.replaceChildren();
  if (!data.bookings.length)
    trips.append(node("p", "No upcoming trips.", "notice"));
  for (const booking of data.bookings) {
    const article = node("article", undefined, "trip");
    const head = node("div", undefined, "trip-head");
    head.append(
      node("h3", booking.booking_reference),
      node("span", booking.status, "mono"),
    );
    article.append(head);
    const body = node("div", undefined, "trip-body");
    for (const segment of booking.itinerary) {
      const row = node("div", undefined, "segment");
      row.append(
        node("strong", segment.flight_number),
        (() => {
          const detail = node("div");
          detail.append(
            node(
              "p",
              segment.origin.code +
                " " +
                segment.origin.city +
                " → " +
                segment.destination.code +
                " " +
                segment.destination.city,
            ),
            node(
              "p",
              localTime(segment.departure, segment.arrival) +
                " · " +
                segment.status.replace("_", " ") +
                " · gate " +
                segment.gate,
            ),
          );
          return detail;
        })(),
        node(
          "span",
          "Seat " +
            (segment.seat || "unassigned") +
            " · " +
            segment.checked_bags +
            " bag" +
            (segment.checked_bags === 1 ? "" : "s") +
            " · " +
            segment.cabin,
          "mono",
        ),
      );
      body.append(row);
    }
    const facts = node("div", undefined, "facts");
    for (const [label, value] of [
      ["Passenger", booking.passenger.name],
      ["Fare", booking.fare.name],
      ["Total paid", money(booking.fare.paid_cents)],
    ]) {
      const fact = node("div", undefined, "fact");
      fact.append(node("span", label), node("strong", value));
      facts.append(fact);
    }
    body.append(facts);
    if (booking.upgrade_offer) {
      const offer = node("p", undefined, "notice");
      offer.textContent =
        "Upgrade offer on " +
        (booking.itinerary.find(
          (segment) => segment.id === booking.upgrade_offer.flight_id,
        )?.flight_number ?? "this trip") +
        ": " +
        money(booking.upgrade_offer.price_cents) +
        ". Ask your agent to review the exact terms.";
      body.append(offer);
    }
    body.append(
      node(
        "p",
        "No real ticket is sold, changed, cancelled or charged. Changes are approved in your agent, not on this page.",
        "notice",
      ),
    );
    article.append(body);
    trips.append(article);
  }
  const loyalty = $("loyalty");
  loyalty.replaceChildren();
  for (const [label, value] of [
    ["Member", data.loyalty.number],
    ["Tier", data.loyalty.tier],
    ["Points", data.loyalty.points.toLocaleString("en-US")],
    [
      "Expiring",
      data.loyalty.expiring_points.toLocaleString("en-US") +
        " on " +
        data.loyalty.expires_on,
    ],
  ]) {
    const fact = node("div", undefined, "activity");
    fact.append(node("h3", label), node("p", value));
    loyalty.append(fact);
  }
  const preferences = $("preferences");
  preferences.replaceChildren();
  const preference = data.bookings[0]?.preference;
  if (preference) {
    for (const [label, value] of [
      ["Meal", preference.meal],
      ["Assistance", preference.assistance.replaceAll("_", " ")],
    ]) {
      const fact = node("div", undefined, "activity");
      fact.append(node("h3", label), node("p", value));
      preferences.append(fact);
    }
  }
  const activity = $("activity-list");
  activity.replaceChildren();
  if (!data.activity.length)
    activity.append(node("p", "No agent proposals yet.", "notice"));
  else {
    const list = node("ol", undefined, "records");
    for (const item of data.activity)
      list.append(record(item, activityNames[item.state] || item.state));
    activity.append(list);
  }
}

let busy = false;
let stopped = false;
let last = "";
async function refresh(force = false) {
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
    if (force || signature !== last) render(data);
    last = signature;
    $("content").setAttribute("aria-busy", "false");
    $("status").className = "live";
    $("status").textContent = "Up to date · refreshes every 2 s";
  } catch {
    $("status").className = "error";
    $("status").textContent =
      "Couldn’t refresh. The last view remains; press Refresh to retry.";
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
    const list = $("access-list");
    list.replaceChildren();
    if (!data.grants.length)
      list.append(node("p", "No agents connected.", "notice"));
    for (const grant of data.grants) {
      const row = node("article", undefined, "activity");
      const revoke = node("button", "Disconnect", "secondary");
      revoke.type = "button";
      row.append(
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
          row.replaceChildren(node("p", "Disconnected."));
          $("access-status").textContent =
            "That agent can no longer reach your account.";
        } catch {
          revoke.disabled = false;
          $("access-status").textContent =
            "We couldn’t confirm it. Reload the list before trying again.";
        }
      });
      list.append(row);
    }
  } catch {
    $("access-status").textContent =
      "Couldn’t load connected agents. Sign in again if the website session expired.";
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
