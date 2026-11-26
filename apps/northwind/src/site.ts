/** Northwind Air website: a synoptic route chart, shared by landing, account and consent. */
import {
  browserAccess,
  consentExpiredHtml,
  consentSheetCss,
  consentSheetHtml,
  labBarHtml,
  labConsentBarHtml,
  labFootCss,
  labFootHtml,
  labPlaygroundUrl,
  specRefHtml,
} from "@poppy-lab/pap-core";
import { skillRowsHtml } from "@poppy-lab/pap-company";
import {
  airports,
  customers,
  fareBrands,
  FICTION_NOTICE,
  flightSchedule,
  PHONE,
  travelInformation,
} from "./data.ts";
import { skills } from "./skills.ts";

export const escape = (text: string) =>
  text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export const fontSources = {
  style: "https://fonts.googleapis.com",
  font: "https://fonts.gstatic.com",
};
export const pageHeaders = {
  "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline' ${fontSources.style}; font-src ${fontSources.font}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
  "Referrer-Policy": "no-referrer",
};
const fonts = `<link rel="preconnect" href="${fontSources.style}"><link rel="preconnect" href="${fontSources.font}" crossorigin><link href="${fontSources.style}/css2?family=Azeret+Mono:wght@400;600&family=Barlow+Condensed:wght@600;700;800&family=Figtree:wght@400;500;650;750&display=swap" rel="stylesheet">`;

const css = `
:root{color-scheme:light;--sky:#dbeaf0;--paper:#f7f4ea;--ink:#102a38;--soft:#385362;--muted:#566b77;--line:#91aab4;--wind:#1d6882;--sun:#efb73e;--alert:#a9382d;--ok:#22694f;--display:"Barlow Condensed","Arial Narrow",sans-serif;--body:Figtree,"Helvetica Neue",sans-serif;--mono:"Azeret Mono",ui-monospace,monospace}
*{box-sizing:border-box}html{background:var(--paper);scroll-behavior:smooth}body{margin:0;color:var(--ink);font:500 17px/1.55 var(--body);-webkit-font-smoothing:antialiased}a{color:inherit;text-underline-offset:.22em}a:hover{text-decoration-thickness:2px}:focus-visible{outline:3px solid var(--sun);outline-offset:3px}::selection{background:var(--sun);color:var(--ink)}button,input,select{font:inherit}code,.mono{font-family:var(--mono);font-size:.9em;font-variant-numeric:tabular-nums}.wrap{width:min(1180px,calc(100% - 2*clamp(18px,4vw,48px)));margin-inline:auto}.notice{color:var(--muted);font-size:14px}.error{color:var(--alert)}.live{color:var(--ok)}
header{background:var(--ink);color:var(--paper);border-bottom:4px solid var(--sun)}header .wrap{min-height:68px;display:grid;grid-template-columns:1fr auto;align-items:center;gap:clamp(18px,3vw,36px)}.brand{font:800 31px/.9 var(--display);letter-spacing:.025em;text-transform:uppercase;text-decoration:none}.brand span{display:block;font:600 10px/1.2 var(--mono);letter-spacing:.14em;color:#b9d2db;margin-top:5px}.nav{display:flex;gap:22px}.nav a{font:650 14px var(--body);text-decoration:none}.nav a[aria-current]{color:var(--sun)}
.chart-hero{position:relative;overflow:hidden;background:var(--sky);min-height:660px;border-bottom:1px solid var(--line)}.isobars{position:absolute;inset:0;width:100%;height:100%;opacity:.48;pointer-events:none}.hero-grid{position:relative;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(360px,.95fr);gap:clamp(34px,6vw,84px);align-items:center;padding-block:clamp(54px,8vw,100px)}h1,h2,h3{font-family:var(--display);text-transform:uppercase;letter-spacing:.005em}.hero-copy h1{font-size:clamp(58px,8.3vw,118px);line-height:.84;margin:0 0 24px;max-width:8ch}.hero-copy p{max-width:58ch;margin:0;color:var(--soft)}.hero-copy .fiction{margin-top:12px;font:600 12px/1.5 var(--mono);color:var(--wind)}
.search-panel{background:var(--paper);border:1px solid var(--ink);padding:clamp(22px,3vw,34px);box-shadow:12px 14px 28px rgba(16,42,56,.14)}.search-panel h2{font-size:32px;line-height:1;margin:0 0 8px}.search-panel>p{margin:0 0 22px;color:var(--soft);font-size:15px}.search-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.search-grid .full{grid-column:1/-1}label{display:block;font:700 12px/1.2 var(--mono);letter-spacing:.05em;text-transform:uppercase;margin:0 0 7px}input,select{width:100%;min-height:50px;border:1px solid var(--line);background:#fffdf6;color:var(--ink);padding:11px 12px;border-radius:0}input:focus,select:focus{border-color:var(--wind)}button,.button{display:inline-flex;align-items:center;justify-content:center;min-height:50px;border:1px solid var(--ink);background:var(--ink);color:var(--paper);padding:11px 20px;font:750 16px var(--display);letter-spacing:.045em;text-transform:uppercase;text-decoration:none;cursor:pointer}.button:hover,button:hover{background:var(--wind)}button:disabled{opacity:.55;cursor:wait}.secondary{background:transparent;color:var(--ink);border-color:var(--line)}.secondary:hover{background:#fffdf6}.search-panel button{width:100%;background:var(--sun);color:var(--ink)}.search-panel button:hover{background:#dca326}.route-note{display:flex;justify-content:space-between;gap:14px;margin-top:16px;padding-top:14px;border-top:1px solid var(--line);font:500 11px/1.45 var(--mono);color:var(--muted)}
.band{background:var(--ink);color:var(--paper);padding:22px 0}.band .wrap{display:grid;grid-template-columns:repeat(3,1fr);gap:0}.band article{padding:0 clamp(18px,3vw,34px);border-right:1px solid #46606d}.band article:first-child{padding-left:0}.band article:last-child{border-right:0}.band h3{font-size:22px;line-height:1;margin:0 0 7px;color:var(--sun)}.band p{font-size:14px;margin:0;color:#cfdee3}
.section{padding-block:clamp(58px,8vw,96px)}.section h2{font-size:clamp(40px,5vw,68px);line-height:.95;margin:0 0 22px;max-width:12ch}.section-lead{max-width:68ch;color:var(--soft);margin:0 0 36px}.departure-board{border-top:2px solid var(--ink)}.flight-row{display:grid;grid-template-columns:110px minmax(0,1.3fr) minmax(0,1fr) 140px;gap:18px;align-items:center;padding:18px 0;border-bottom:1px solid var(--line)}.flight-row strong{font:750 24px/1 var(--display)}.flight-row .route{font-size:18px}.flight-row .time,.flight-row .fare{font-family:var(--mono);font-size:13px}.flight-row .fare{text-align:right}.status{display:inline-block;padding:4px 8px;background:var(--sun);font:600 11px var(--mono);text-transform:uppercase}.flight-row .route small{display:block;font:500 12px var(--mono);color:var(--muted)}.results{padding-block:clamp(40px,6vw,72px)}.results h1{font-size:clamp(44px,6vw,80px);line-height:.9;margin:0 0 10px}.results .when{margin:0 0 32px;color:var(--soft)}.itinerary{border:1px solid var(--line);background:#fffdf6;margin-bottom:18px}.itinerary-head{display:flex;justify-content:space-between;align-items:baseline;gap:16px;flex-wrap:wrap;padding:14px 18px;background:var(--sky);border-bottom:1px solid var(--line)}.itinerary-head strong{font:750 24px/1 var(--display);text-transform:uppercase}.itinerary-head span{font-family:var(--mono);font-size:14px}.itinerary .flight-row{padding-inline:18px;grid-template-columns:110px minmax(0,1fr) auto}.itinerary .flight-row:last-child{border-bottom:0}.results-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(300px,.8fr);gap:clamp(28px,5vw,56px);align-items:start}.results .search-panel{box-shadow:none}.results .empty{border-top:2px solid var(--ink);padding-top:18px}.results .empty ul{padding-left:20px}.info-grid{display:grid;grid-template-columns:1.2fr .8fr 1fr;gap:clamp(26px,4vw,52px)}.info-grid article{border-top:2px solid var(--ink);padding-top:18px}.info-grid h3{font-size:28px;line-height:1;margin:0 0 10px}.info-grid p{margin:0;color:var(--soft)}
.agent-strip{background:var(--sun);padding:clamp(34px,5vw,58px) 0}.agent-strip .wrap{display:grid;grid-template-columns:1fr auto;align-items:center;gap:30px}.agent-strip h2{font-size:clamp(38px,5vw,64px);line-height:.9;margin:0 0 12px}.agent-strip p{margin:0;max-width:64ch}.agent-strip .button{white-space:nowrap}
.table-wrap{overflow-x:auto;border:1px solid var(--line);background:#fffdf6}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:12px 14px;border-bottom:1px solid #c9d5d9;vertical-align:top}thead th{font:600 11px var(--mono);letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}tbody th{white-space:nowrap}.personas{display:grid;grid-template-columns:repeat(2,1fr);gap:18px;list-style:none;padding:0;margin:0}.personas li{border-top:2px solid var(--ink);padding:18px 0}.personas strong{display:block;font:750 28px/1 var(--display);text-transform:uppercase}.personas span{color:var(--soft);font-size:14px}
${labFootCss}footer{background:#091c26;padding:56px 0}.lab-foot{--foot-ink:var(--paper);--foot-soft:#c8d9df;--foot-muted:var(--line);--foot-rule:#46606d}.lab-foot-name{font:800 31px/1.1 var(--display);letter-spacing:.025em;text-transform:uppercase}
.account-shell{padding-block:clamp(38px,6vw,70px)}.account-head{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:end;border-bottom:2px solid var(--ink);padding-bottom:22px;margin-bottom:34px}.account-head h1{font-size:clamp(50px,7vw,84px);line-height:.88;margin:0 0 12px}.account-head p{margin:0;max-width:65ch;color:var(--soft)}.live-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.live-row p{width:100%;margin:0 0 4px;text-align:right}.account-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(300px,.75fr);gap:clamp(28px,5vw,58px)}.account-grid section{margin-bottom:38px}.account-grid h2{font-size:34px;line-height:1;margin:0 0 14px;border-bottom:1px solid var(--line);padding-bottom:10px}.trip{border:1px solid var(--line);background:#fffdf6;margin-bottom:18px}.trip-head{display:flex;justify-content:space-between;gap:16px;align-items:baseline;padding:16px 18px;background:var(--sky);border-bottom:1px solid var(--line)}.trip-head h3{font-size:28px;line-height:1;margin:0}.trip-body{padding:18px}.segment{display:grid;grid-template-columns:90px 1fr auto;gap:14px;padding:13px 0;border-bottom:1px solid #d5dedf}.segment strong{font:750 22px var(--display)}.segment p{margin:0;color:var(--soft);font-size:14px}.segment .mono{text-align:right}.facts{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px}.fact{border-top:1px solid var(--line);padding-top:10px}.fact span{display:block;color:var(--muted);font-size:12px}.fact strong{font-size:16px}.activity{padding:13px 0;border-bottom:1px solid var(--line)}.activity h3{font-size:20px;line-height:1;margin:0 0 5px}.activity p{margin:0;color:var(--soft);font-size:14px}.records{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}.record{display:grid;gap:6px;padding:16px 0 18px;border-bottom:1px solid var(--line);overflow-wrap:anywhere}.record-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 16px}.record-when{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}.record-title{margin:4px 0 0;max-width:65ch}.record-body{margin:0;max-width:65ch;font-size:15px;line-height:1.55}.record-meta{margin:0;font-size:13px;color:var(--muted)}.record[data-tone=muted] .record-tag{background:transparent;color:var(--muted);box-shadow:inset 0 0 0 1px var(--line)}.record-tag{font:600 12px/1 var(--mono);letter-spacing:.03em;text-transform:uppercase;padding:6px 8px 5px;border-radius:2px;background:#d6eadf;color:var(--ok)}.record[data-tone=pending] .record-tag{background:var(--sun);color:var(--ink)}.record[data-tone=info] .record-tag{background:var(--sky);color:var(--wind)}.record-when{font-family:var(--mono);font-size:12px}.record-title{font:600 16px/1.4 var(--body);color:var(--ink)}.record-body{color:var(--soft);font-size:14px}.account-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
@media(max-width:900px){.hero-grid{grid-template-columns:1fr;padding-block:56px}.chart-hero{min-height:0}.hero-copy h1{max-width:9ch}.band .wrap{grid-template-columns:1fr}.band article{padding:16px 0;border-right:0;border-bottom:1px solid #46606d}.band article:last-child{border-bottom:0}.info-grid{grid-template-columns:1fr}.agent-strip .wrap{grid-template-columns:1fr}.agent-strip .button{justify-self:start}.account-grid{grid-template-columns:1fr}.live-row p{text-align:left}.account-head{grid-template-columns:1fr}.flight-row{grid-template-columns:90px 1fr 110px}.flight-row .time{display:none}.results-grid{grid-template-columns:1fr}}
@media(max-width:620px){header .wrap{min-height:62px;grid-template-columns:1fr;gap:8px;padding-block:12px}.brand{font-size:24px}.brand span{display:none}.nav{gap:16px}.nav a{font-size:12px;white-space:nowrap}.hero-copy h1{font-size:58px}.search-grid{grid-template-columns:1fr}.search-grid .full{grid-column:auto}.route-note{display:block}.route-note span{display:block;margin-top:6px}.flight-row{grid-template-columns:72px 1fr}.flight-row .fare{grid-column:2;text-align:left}.personas{grid-template-columns:1fr}.facts{grid-template-columns:1fr 1fr}.segment{grid-template-columns:72px 1fr}.segment .mono{grid-column:2;text-align:left}}
${consentSheetCss}.sheet{--sheet-rule:var(--line);--sheet-accent:var(--wind)}
.sheet h1{font-size:clamp(40px,5.4vw,68px);line-height:.9}
.sheet-agent{color:var(--soft)}.sheet-agent strong{color:var(--ink)}
.sheet-verified{padding:4px 8px;background:var(--sun);color:var(--ink);font:600 11px var(--mono);text-transform:uppercase}
.sheet legend,.sheet h2{font:800 30px/1 var(--display);text-transform:uppercase;letter-spacing:.005em}
.sheet-cols{border-top:2px solid var(--ink)}
.sheet-person,.sheet-option{font:inherit;letter-spacing:0;text-transform:none}
.sheet-person{background:#fffdf6}
.sheet-person strong{font:750 22px/1.05 var(--display);text-transform:uppercase}
.sheet-person small{font:500 12px var(--mono);color:var(--muted);margin-top:4px}
.sheet-note,.sheet-reads span,.sheet-option span span,.sheet-none,.sheet-foot p{color:var(--soft)}
.sheet-note{font-size:14px}
.sheet-group h3{font-size:23px;line-height:1}
.sheet-group h3 span{font:500 11px var(--mono);letter-spacing:.02em;text-transform:none;color:var(--muted)}
.sheet-reads strong,.sheet-option strong{font-weight:750}
.sheet-reads span,.sheet-option span span{font-size:15px}
.sheet-foot p{font-size:15px}
.sheet-fine{font-size:13px;color:var(--muted)}
`;

export function shell(
  title: string,
  body: string,
  current: "/" | "/for-agents" | "/account" | "/how-it-works",
  origin: string,
  /** Rules of one page only, after the site's own. */
  style = "",
) {
  const nav = (
    [
      ["/", "Flights"],
      ["/for-agents", "For agents"],
      ["/account", "My Northwind"],
      ["/how-it-works", "How it works"],
    ] as const
  )
    .map(
      ([href, label]) =>
        `<a href="${href}"${current === href ? ' aria-current="page"' : ""}>${label}</a>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>${fonts}<style>${css}${style}</style></head><body>${labBarHtml(origin, "Northwind Air")}<header><div class="wrap"><a class="brand" href="/">Northwind Air</a><nav class="nav" aria-label="Site">${nav}</nav></div></header>${body}<footer><div class="wrap">${labFootHtml(origin, "northwind", { name: "Northwind Air", notice: ["Northwind Air is a fictional airline for testing personal agents. No real flight, ticket, passenger record, loyalty balance, payment, cancellation or border advice exists.", `Fictional assistance desk: <span class="mono">${PHONE}</span>. Never enter a real booking reference, passport, payment card, medical record or account credential.`] })}</div></footer></body></html>`;
}

const city = (code: string) =>
  airports.find((airport) => airport.code === code)?.city ?? code;
const airportOptions = (selected: string) =>
  airports
    .map(
      (airport) =>
        `<option value="${airport.code}"${airport.code === selected ? " selected" : ""}>${airport.code} — ${escape(airport.city)}</option>`,
    )
    .join("");
/** "Tuesday 18 May 2027" for a valid ISO date, or the text as given. */
const longDate = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : date;
const shortDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const clock = (iso: string) => iso.slice(11, 16);
const searchForm = (from: string, to: string, date: string, heading: string) =>
  `<form class="search-panel" method="get" action="/flights"><h2>${heading}</h2><p>The demo timetable is small. Try Port Aurora to Sunmere on 3 June 2027, or Port Aurora to Northhaven on 18 May 2027.</p><div class="search-grid"><div><label for="origin">From</label><select id="origin" name="origin">${airportOptions(from)}</select></div><div><label for="destination">To</label><select id="destination" name="destination">${airportOptions(to)}</select></div><div class="full"><label for="date">Departure date</label><input id="date" name="date" type="date" value="${escape(date)}" required></div><div class="full"><button type="submit">Search flights</button></div></div><div class="route-note">No real ticket is sold, changed, cancelled or charged.</div></form>`;

const chart = `<svg class="isobars" viewBox="0 0 1400 720" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="#568296" stroke-width="1.2"><path d="M-80 210 C180 70 390 80 560 230 S930 460 1510 160"/><path d="M-100 280 C190 120 420 130 610 285 S1000 520 1510 235"/><path d="M-120 350 C210 180 450 200 650 350 S1060 580 1530 305"/><path d="M40 680 C160 490 360 430 540 510 S930 690 1110 520 S1340 360 1510 400"/><ellipse cx="1110" cy="170" rx="230" ry="105"/><ellipse cx="1110" cy="170" rx="170" ry="72"/><ellipse cx="260" cy="570" rx="260" ry="120"/></g><g fill="#1d6882"><circle cx="238" cy="425" r="6"/><circle cx="618" cy="326" r="6"/><circle cx="995" cy="252" r="6"/></g><path d="M238 425 C420 380 470 350 618 326 S850 286 995 252" fill="none" stroke="#1d6882" stroke-width="3" stroke-dasharray="8 8"/></svg>`;

export function homePage(origin: string) {
  const board = flightSchedule
    .slice(0, 5)
    .map(
      (flight) =>
        `<div class="flight-row"><strong>${escape(flight.number)}</strong><span class="route">${escape(city(flight.origin))} → ${escape(city(flight.destination))}<small>${flight.origin} → ${flight.destination}</small></span><span class="time">${shortDate(flight.departure)} · ${clock(flight.departure)}</span><span class="fare">from ${money(flight.economy_cents)} <span class="status">${escape(flight.status.replace("_", " "))}</span></span></div>`,
    )
    .join("");
  const information = Object.values(travelInformation)
    .map(
      (item) =>
        `<article><h3>${escape(item.title)}</h3><p>${escape(item.text)}</p></article>`,
    )
    .join("");
  const body = `<main><section class="chart-hero">${chart}<div class="wrap hero-grid"><div class="hero-copy"><h1>Follow the route. Keep control of the ticket.</h1><p>Search the Northwind network, manage your trip online, or hand the legwork to your personal agent. Seats, bags, upgrades and flight changes always show the exact price before you confirm.</p></div>${searchForm("PAU", "SMR", "2027-06-03", "Search flights")}</div></section><section class="band"><div class="wrap"><article><h3>Plan your trip</h3><p>Flights, cheapest dates, flight status, baggage and check-in rules. No account needed.</p></article><article><h3>My Northwind</h3><p>Your upcoming trips, seats and bags, Gale loyalty points and travel preferences.</p></article><article><h3>Changes on your terms</h3><p>A new seat, an extra bag, an upgrade or another flight: you see the exact cost first, and it is applied once.</p></article></div></section><section class="section wrap"><h2>Departures</h2><p class="section-lead">Next departures across the network. Fares are the lowest economy price for one passenger.</p><div class="departure-board">${board}</div></section><section class="section wrap"><h2>Before the airport</h2><div class="info-grid">${information}</div></section><section class="agent-strip"><div class="wrap"><div><h2>Travel with a personal agent.</h2><p>Northwind works with personal AI agents. Yours can look up flights, read your trips and get a seat, bag or flight change ready. You sign in on Northwind's own page, and you approve the exact fare difference yourself. <a href="/how-it-works">See each step as your agent sees it</a>.</p></div><a class="button" href="${labPlaygroundUrl(origin)}">Try it with Iris, the demo agent</a></div></section></main>`;
  return shell("Northwind Air · Flights", body, "/", origin);
}

type Segment = {
  flight_number: string;
  origin?: { code: string; city: string } | undefined;
  destination?: { code: string; city: string } | undefined;
  departure: string;
  arrival: string;
  status: string;
};
/** Search results as a page for people; agents use `/api/flights/search`. */
export function flightsPage(
  origin: string,
  query: { origin: string; destination: string; date: string },
  itineraries: Array<{
    segments: Array<Segment | undefined>;
    from_cents: number;
  }>,
) {
  const known = (code: string) =>
    airports.some((airport) => airport.code === code);
  const from = known(query.origin) ? query.origin : "PAU";
  const to = known(query.destination) ? query.destination : "SMR";
  const list = itineraries
    .map((itinerary) => {
      const segments = itinerary.segments.filter(
        (segment): segment is Segment => !!segment,
      );
      const stops =
        segments.length > 1
          ? `1 stop in ${escape(segments[0]!.destination?.city ?? "")}`
          : "Direct";
      const rows = segments
        .map(
          (segment) =>
            `<div class="flight-row"><strong>${escape(segment.flight_number)}</strong><span class="route">${escape(segment.origin?.city ?? "")} ${clock(segment.departure)} → ${escape(segment.destination?.city ?? "")} ${clock(segment.arrival)}<small>${escape(segment.origin?.code ?? "")} → ${escape(segment.destination?.code ?? "")}</small></span><span class="status">${escape(segment.status.replace("_", " "))}</span></div>`,
        )
        .join("");
      return `<article class="itinerary"><div class="itinerary-head"><strong>${stops}</strong><span>from ${money(itinerary.from_cents)} per passenger</span></div>${rows}</article>`;
    })
    .join("");
  const none = `<div class="empty"><p><strong>No Northwind flights on that day.</strong> The demo timetable only has a few departures. These searches have results:</p><ul><li><a href="/flights?origin=PAU&amp;destination=SMR&amp;date=2027-06-03">Port Aurora to Sunmere, 3 June 2027</a></li><li><a href="/flights?origin=PAU&amp;destination=NTH&amp;date=2027-05-18">Port Aurora to Northhaven, 18 May 2027</a></li><li><a href="/flights?origin=PAU&amp;destination=CDB&amp;date=2027-05-18">Port Aurora to Cinder Bay, 18 May 2027</a></li></ul></div>`;
  const body = `<main class="wrap results"><h1>${escape(city(from))} to ${escape(city(to))}</h1><p class="when">${escape(longDate(query.date))} · one passenger</p><div class="results-grid"><div>${list || none}<p class="notice">This is a demo, so nothing can be booked here. To change a trip you already have, open <a href="/account">My Northwind</a> or <a href="${labPlaygroundUrl(origin)}">ask a personal agent</a>.</p></div>${searchForm(from, to, query.date, "Search again")}</div></main>`;
  return shell(
    `${city(from)} to ${city(to)} · Northwind Air`,
    body,
    "/",
    origin,
  );
}

export function forAgentsPage(origin: string) {
  const rows: Array<[string, string, string]> = [
    ["Discovery", `${origin}/.well-known/poppy.json`, "§3"],
    [
      "Protected resource",
      `${origin}/.well-known/oauth-protected-resource`,
      "§3.2",
    ],
    [
      "Authorization server",
      `${origin}/.well-known/oauth-authorization-server`,
      "§3.2",
    ],
    [
      "Direct Sign-In",
      `POST ${origin}/oauth/par · GET ${origin}/oauth/authorize`,
      "§4.2",
    ],
    [
      "Tokens",
      `POST ${origin}/oauth/token · private_key_jwt · DPoP`,
      "§4.4–4.5",
    ],
    [
      "Sessions",
      "Poppy-Session · Poppy-Version: 1.0 · Operations v3 declaration",
      "§3.4, §5",
    ],
    ["OpenAPI", `${origin}/openapi.json`, "§7"],
    [
      "Tasks",
      `${origin}/poppy/tasks · excluded tasks, skills, feedback endpoint`,
      "§9",
    ],
    ["Conversations", `${origin}/poppy/conversations`, "§8"],
    [
      "Approvals",
      "403 approval_required → resend exact request with Poppy-Approval",
      "Operations v3",
    ],
  ];
  const people = customers
    .map(
      (customer) =>
        `<li><strong>${escape(customer.name)}</strong><span>Account <code>${customer.id}</code> · booking <code>${customer.booking.reference}</code> · surname <code>${customer.booking.surname}</code> · ${escape(fareBrands[customer.booking.fare].name)}</span></li>`,
    )
    .join("");
  const body = `<main class="section wrap"><h1 style="font:800 clamp(58px,9vw,112px)/.85 var(--display);margin:0 0 24px;max-width:9ch">A complete airline-shaped Poppy 1.0 Company.</h1><p class="section-lead">Northwind Air is deterministic, fictional and deployable on Node or Cloudflare Workers. It uses the shared Company gateway without compatibility routes for earlier Poppy versions.</p><h2>Endpoints</h2><div class="table-wrap"><table><thead><tr><th>What</th><th>Where</th><th>Protocol</th></tr></thead><tbody>${rows.map(([what, where, spec]) => `<tr><th scope="row">${what}</th><td><code>${escape(where)}</code></td><td>${specRefHtml(spec)}</td></tr>`).join("")}</tbody></table></div><section class="section"><h2>Test passengers</h2><ul class="personas">${people}</ul><p class="section-lead">Try: “Move Robin from NA 274 to NA 278.” The proposal states the old and new departure, fare difference, change fee, amount due or refund, seat reset and fictional payment terms. Change the inventory price before approval and the old revision no longer executes.</p></section><section class="section"><h2>Scope shape</h2><div class="table-wrap"><table><tbody><tr><th><code>flights:search</code></th><td>Public search shape; no personal data and no changes.</td></tr><tr><th><code>bookings:read</code></th><td>Trips and booking details.</td></tr><tr><th><code>profile:read</code></th><td>Loyalty and preferences.</td></tr><tr><th><code>preferences:write</code></th><td>Reversible seats, meals and supported non-medical assistance.</td></tr><tr><th><code>bookings:change</code></th><td>Paid, irreversible or financially consequential booking changes.</td></tr></tbody></table></div></section><section class="section"><h2>Published skills</h2><p class="section-lead">A skill is a note Northwind wrote for agents on how to do one task with its API. It grants nothing, and a change still waits for the passenger's approval. The tasks response lists each skill with the digest of its file (${specRefHtml("§9.4")}).</p><div class="table-wrap"><table><tbody>${skillRowsHtml(skills)}</tbody></table></div></section><a class="button" href="${labPlaygroundUrl(origin)}">Connect Northwind in Iris</a></main>`;
  return shell("For agents · Northwind Air", body, "/for-agents", origin);
}

/**
 * What `scopes` let an agent read and propose, as the consent page says it.
 * The account page lists a connected agent's permission in the same words.
 */
export function permissions(scopes: string) {
  const requested = scopes.split(" ").filter(Boolean);
  const reads: Record<string, { title: string; text: string }> = {
    "flights:search": {
      title: "Flights and fares",
      text: "Search flights. Search also works without account access.",
    },
    "bookings:read": {
      title: "Your trips",
      text: "Upcoming trips, booking details, seats, bags and fare terms.",
    },
    "profile:read": {
      title: "Your profile",
      text: "Loyalty tier, points, expiring points and passenger preferences.",
    },
  };
  const changes: Record<string, string> = {
    "preferences:write":
      "Seat, meal and supported non-medical assistance preferences.",
    "bookings:change":
      "Paid baggage, cancellation, upgrades and flight changes.",
  };
  const proposed = requested.filter((scope) => scope in changes);
  return {
    reads: requested.flatMap((scope) => (reads[scope] ? [reads[scope]] : [])),
    changes: proposed.length
      ? [
          {
            name: "write",
            title: "Your trips and preferences",
            text: proposed.map((scope) => changes[scope]).join(" "),
            checked: true,
          },
        ]
      : [],
    ...browserAccess(scopes),
  };
}

/** The consent page's frame: the airline's header without links, then the sheet. */
const consentFrame = (title: string, sheet: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Northwind Air</title>${fonts}<style>${css}</style></head><body>${labConsentBarHtml("Northwind Air")}<header><div class="wrap"><span class="brand">Northwind Air</span></div></header>${sheet}</body></html>`;

export function consentPage(input: {
  nonce: string;
  passwordRequired: boolean;
  scopes: string;
  client: string;
  clientHost: string;
  account?: string;
}) {
  const sheet = consentSheetHtml({
    company: "Northwind",
    agent: input.client,
    agentHost: input.clientHost,
    nonce: input.nonce,
    passwordRequired: input.passwordRequired,
    chosen: input.account,
    personKind: "passenger",
    people: customers.map((customer) => ({
      id: customer.id,
      name: customer.name,
      note: `Booking ${customer.booking.reference}`,
    })),
    ...permissions(input.scopes),
    disconnect: "You can take the permission away under My Northwind.",
    fine: `${FICTION_NOTICE} Never enter a real airline password, booking reference, passport, payment card or medical record.`,
  });
  return consentFrame(`Allow ${input.client}`, sheet);
}

/** In the consent page's place, when it is answered after its five minutes. */
export const consentExpiredPage = () =>
  consentFrame("This page has expired", consentExpiredHtml("Northwind"));
