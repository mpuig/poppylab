---
name: Poppy Lab
description: An independent lab for Personal Agent Protocol, drawn as a published standard.
colors:
  green: "#0d5c4a"
  green-deep: "#0a4a3b"
  green-mid: "#4f9484"
  green-light: "#9cc7bb"
  green-wash: "#eaf3f0"
  amber: "#f2b705"
  amber-wash: "#fff6d6"
  amber-deep: "#c99700"
  danger: "#b3261e"
  paper: "#ffffff"
  ink: "#171a1f"
  ink-soft: "#3a4049"
  muted: "#5b626c"
  on-ink-muted: "#c4c9d0"
  line: "#e3e6ea"
  line-strong: "#c9ced5"
  tint: "#f4f6f7"
  selection: "#cfe5df"
  juniper: "#17342b"
  lantern: "#c62f1e"
  harborline: "#073b5c"
  northwind: "#1d6882"
  fernwick: "#2c5a41"
typography:
  display:
    fontFamily: "STIX Two Text, Georgia, serif"
    fontSize: "clamp(38px, 4.3vw, 58px)"
    fontWeight: 500
    lineHeight: 1.06
    letterSpacing: "-0.02em"
  display-reading:
    fontFamily: "STIX Two Text, Georgia, serif"
    fontSize: "clamp(34px, 3.8vw, 48px)"
    fontWeight: 500
    lineHeight: 1.06
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "STIX Two Text, Georgia, serif"
    fontSize: "clamp(28px, 2.8vw, 36px)"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  title-serif:
    fontFamily: "STIX Two Text, Georgia, serif"
    fontSize: "26px"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Hanken Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.005em"
  lead:
    fontFamily: "Hanken Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.6
  body:
    fontFamily: "Hanken Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.6
  body-small:
    fontFamily: "Hanken Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  label-large:
    fontFamily: "Hanken Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Hanken Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: "Hanken Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  micro:
    fontFamily: "Hanken Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  numeral:
    fontFamily: "STIX Two Text, Georgia, serif"
    fontSize: "21px"
    fontWeight: 500
  wordmark:
    fontFamily: "STIX Two Text, Georgia, serif"
    fontSize: "21px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  mono:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "12.5px"
    fontWeight: 400
  mono-small:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
rounded:
  xs: "3px"
  tag: "4px"
  sm: "5px"
  md: "6px"
  lg: "8px"
  xl: "10px"
  full: "999px"
spacing:
  gutter: "clamp(20px, 4vw, 40px)"
  container: "1120px"
  section: "clamp(64px, 8vw, 104px)"
  section-gap: "clamp(32px, 4vw, 48px)"
  row: "14px"
  panel: "16px"
components:
  button-primary:
    backgroundColor: "{colors.green}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
    padding: "0 18px"
    height: "46px"
  button-primary-hover:
    backgroundColor: "{colors.green-deep}"
  button-primary-active:
    backgroundColor: "{colors.green-deep}"
  button-small:
    backgroundColor: "{colors.green}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "40px"
  button-ghost:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 18px"
    height: "46px"
  button-dark:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
  button-dark-hover:
    backgroundColor: "{colors.ink-soft}"
  approval-gate:
    backgroundColor: "{colors.amber-wash}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "14px 16px"
  approval-gate-done:
    backgroundColor: "{colors.green-wash}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  figure-node:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  figure-node-you:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
  figure-node-company:
    backgroundColor: "{colors.tint}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  screen-panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "16px"
  step-stop:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.green}"
    typography: "{typography.numeral}"
    rounded: "{rounded.full}"
    size: "44px"
  company-card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  company-card-head-juniper:
    backgroundColor: "{colors.juniper}"
    textColor: "{colors.paper}"
    typography: "{typography.title-serif}"
    padding: "18px 24px"
  company-card-head-lantern:
    backgroundColor: "{colors.lantern}"
    textColor: "{colors.paper}"
    typography: "{typography.title-serif}"
    padding: "18px 24px"
  company-card-head-harborline:
    backgroundColor: "{colors.harborline}"
    textColor: "{colors.paper}"
    typography: "{typography.title-serif}"
    padding: "18px 24px"
  company-card-head-northwind:
    backgroundColor: "{colors.northwind}"
    textColor: "{colors.paper}"
    typography: "{typography.title-serif}"
    padding: "18px 24px"
  company-card-head-fernwick:
    backgroundColor: "{colors.fernwick}"
    textColor: "{colors.paper}"
    typography: "{typography.title-serif}"
    padding: "18px 24px"
  pill:
    backgroundColor: "{colors.green}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "30px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "44px"
  conversation:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
---

# Design System: Poppy Lab

This file records two things. The canonical sections that follow (Overview to Do's and Don'ts) describe poppylab.dev itself: the home (`/`), `/developers`, `/learn` and the playground at `/playground`. The sections after them describe the five fictional Companies, each of which keeps its own visual world on purpose (Fernwick's site is described in `docs/fernwick-power.md`), and the playground's behaviour.

## Overview

**Creative North Star: "The Published Standard"**

Poppy Lab presents Personal Agent Protocol the way a standards body presents a specification: a quiet white page whose proof is drawn. Each claim gets one precise thin-line figure with a plain sentence for a caption, and the copy around it stays short. Figures are not numbered; each is known by what it is: the sequence, the spectrum, the flow diagram, the comparison and the who-does-what matrix on the home, the pairs on `/developers`. The first thing a visitor meets is the sequence, between You, Iris and Juniper Market, which halts on an amber row until they press Approve.

The world is white paper, graphite ink, hairlines and two colours with fixed meanings. Petrol green is the action, the figure stroke and everything that exists "with Poppy". Amber marks only what waits for the person or what only the person does. Headings and the wordmark are set in STIX Two Text, the face of technical publishing; everything else is Hanken Grotesk, with Geist Mono for code. One departure from the two-colour page is deliberate: on the home, each of the five fictional Companies is a card headed in that Company's own leading colour. There are no cast shadows and no themed objects: PRODUCT.md commits the site to interest that comes from precise diagrams, in the register of personalagentprotocol.org without resembling it.

The same tokens serve three modes. The home persuades, `/developers` and `/learn` are for reading, and the playground operates: it takes type, palette, density and state colours from this world and keeps its own structure.

**Key Characteristics:**

- White ground, graphite ink, 1px hairlines; sections separated by a rule, never by a coloured band.
- One figure per claim, unnumbered, each with a plain sentence caption in muted sans.
- Green for action and for "with Poppy"; amber only for what is the person's to do.
- The five Companies' own colours appear once, as the header bands of their cards on the home.
- Serif for headings and the wordmark, sans for everything else, mono for code and spec references.
- Flat: no cast shadows, no gradients, no decorative panels.
- Every figure survives at every width, redrawn or restacked instead of hidden.

## Colors

A near-monochrome page with two signal colours, each tied to one meaning, and five borrowed colours that belong to the fictional Companies. The stylesheets declare the same values twice: on `.site` in `site.css` (`--green`, `--amber`, `--tint`) and on `:root` in `playground.css` (`--accent`, `--wait`, `--soft`). The petrol ramp and `amber-deep` exist only in `site.css`, where the figures are.

### Primary

- **Petrol Green** (`green`): the primary button, the Approve control, figure connectors and arrowheads, message numbers in the sequence, the ring and numeral of each stop on the "How it works" rail, the "With Poppy" column head of the comparison and its rule, the dots of the who-does-what matrix, the 2px rule under the current nav item, links inside `/learn` prose, and the "done" state in the playground. Hover and pressed are **Deep Petrol** (`green-deep`).
- **Petrol ramp** (`green-light`, `green-mid`, `green`): the three "With Poppy" steps of the spectrum, lightest for browsing and deepest for a change that needs approval. `green-light` is also the border of a settled approval and the underline of `/learn` links.
- **Petrol Wash** (`green-wash`): the ground of the approval row once approved.

### Secondary

- **Signal Amber** (`amber`): a thin rule or border, a small dot or a small count mark, never the fill of a panel. It marks the waiting approval in the sequence, the two actions only the person takes in the flow diagram, "Waiting for you" on proposals and on each Company card, the "You" column of the who-does-what matrix, and in the playground the current guide step and the count of items that need the person.
- **Amber Wash** (`amber-wash`): the ground behind an amber-bordered element.
- **Deep Amber** (`amber-deep`): one job, the 1px ring that holds the edge of an amber dot on white in the who-does-what matrix. Never a fill or a text colour.

### Tertiary

- **Error Red** (`danger`): playground only, for failed checks and for the error block, where it is the icon, a 35% rule and a 5% wash over paper with the message in ink. It does not appear on the home, `/developers` or `/learn`.
- **Company colours** (`juniper`, `lantern`, `harborline`, `northwind`, `fernwick`): the leading colour of each fictional Company's own website (Juniper's forest green, Lantern's red, Harborline's channel blue, Northwind's route blue, Fernwick's fern-green masthead). Home only, one job: the header band of that Company's card, and the card's border on hover. Each is set per card as `--brand` from `companies[].brand` in `site-chrome.tsx`; the sector beside the name is paper mixed 80% with the brand.

### Neutral

- **Paper** (`paper`): the ground of the home, `/developers` and `/learn`, and every working surface. In the playground paper is the header, the conversation, inputs, cards and quiet buttons, which stand off a tint ground. It is also the Company's name on the coloured band of its card.
- **Graphite Ink** (`ink`): text, the solid "You" node, the 1px rule that opens a list or table, the dark button.
- **Soft Ink** (`ink-soft`): supporting paragraphs and list text.
- **Muted** (`muted`): captions, notes, table column heads, inactive nav, the "Without a protocol" sentence of the comparison.
- **On-ink Muted** (`on-ink-muted`): secondary text inside the solid ink node.
- **Hairline** (`line`): section rules and row dividers.
- **Strong Hairline** (`line-strong`): borders of controls, panels and Company cards, sequence lifelines, pending connectors, the line of the steps rail, the rule under a "Without a protocol" column head, link underlines at rest.
- **Tint** (`tint`): the company party in figures, code blocks and inline code on `/learn`, the footer, the hatched "Without a protocol" swatch of the spectrum, the playground's page ground (`--background`) and its quiet bars inside the conversation.
- **Selection** (`selection`): text selection on every surface.

### Named Rules

**The Amber Is Yours Rule.** Amber appears only where something waits for the person or where only the person can act. It is never a brand accent, a highlight or a warning about the product.

**The Green Means Poppy Rule.** Green is the action and the protocol's side of any comparison. A column, step or mark that describes life without a protocol stays in the neutrals: ink, soft ink, muted and hairline.

**The Company's Own Colour Rule.** A colour outside green, amber, error red and the neutrals appears in one place: the header band of a Company's card on the home, and that card's border on hover. It is there because it is that Company's own colour, the one its website leads with. It never colours a button, a link, a figure or anything that speaks for Poppy Lab, and no sixth colour joins the five without a sixth Company.

## Typography

**Display Font:** STIX Two Text (with Georgia, serif), roman only
**Body Font:** Hanken Grotesk (with Helvetica Neue, Arial, sans-serif)
**Label/Mono Font:** Geist Mono (with ui-monospace, SF Mono, Menlo)

**Character:** A publishing serif at medium weight over a plain, slightly warm grotesque. The serif carries authority without ornament; the sans does all the work of reading and of the interface. All three load through `next/font/google` in `layout.tsx`.

### Hierarchy

The ramp is a closed set of sizes in whole pixels: 58 to 38 and 48 to 34 (fluid), 36 to 28 (fluid), 26, 21, 19, 18, 17, 16, 15, 14, 13 and 12, plus 12.5 for mono on the site. Every literal in both stylesheets is one of these steps.

- **Display** (500, clamp(38px, 4.3vw, 58px), 1.06, -0.02em): the one h1 of the home and `/developers`.
- **Reading display** (500, clamp(34px, 3.8vw, 48px), 1.06, -0.02em): the page title on `/learn`, a step down so it sits over long prose.
- **Headline** (500, clamp(28px, 2.8vw, 36px), 1.15, -0.015em): section h2.
- **Serif title** (500, 26px, 1.15, -0.01em): a Company's name on its card, the row heads of the comparison (People, Companies, Agent builders), the h2 inside `/learn` prose and the playground's h1. The same 26px in sans 600 with tabular figures is the headline value of a proposal in the playground.
- **Wordmark** (serif 600, 21px, -0.01em): "Poppy Lab" in the bar, the footer and the playground header.
- **Numeral** (serif 500, 21px, lining figures, green): the number inside each stop of the steps rail.
- **Title** (sans 600, 19px, 1.3): h3, step titles, the bold line of a spectrum step; at weight 500 and 1.4, the sentence to ask on a Company card.
- **Lead** (400, 18px, 1.6, max 54 to 62ch): the paragraph under an h1 or h2, in soft ink; also the "With Poppy" sentence of the comparison (ink, 1.5) and party names in the flow diagram (600). The hero lead reaches 19px on wide screens.
- **Body** (400, 17px, 1.6): prose at 66ch on `/learn`, 44 to 56ch beside figures; the paragraph under a step, the "Without a protocol" sentence of the comparison (muted, 1.5), the bold line of the approval row and a change's new value in a screen panel (600).
- **Small body** (400 to 600, 16px): button text, the points beside the who-does-what matrix, the line on what a Company card shows, ruled list rows on `/developers`, and the base size below 520px and in the playground.
- **Large label** (400 to 600, 15px, 1.4 to 1.45): nav links, small buttons, sequence labels and party heads, tables and matrices, the rows of a Company card's change, notes, footer text and links, playground message text.
- **Label** (400 to 600, 14px, 1.4 to 1.5): captions, column heads, panel text, a Company's sector, the footer's group titles (600, ink), most playground interface text. Sentence case, no tracking, no capitals.
- **Caption** (400 to 600, 13px): the second line of a party head, and in the playground field labels, message labels, helper notes and guide steps. Sequence labels drop to it at 520px and below.
- **Micro** (400 to 600, 12px): playground only, apart from narrow screens: the count in a pill, the guide's step number, state marks, the footer, tabs at 520px and below. Sequence labels drop to it at 380px and below. Nothing is set smaller.
- **Mono** (12.5px for spec references and codes on the site, 14px for endpoint links and code blocks, 0.86em inline): paths, endpoints, scopes, spec sections.
- **Small mono** (12px, 1.5 to 1.9): the playground's timings, request log, scopes and raw documents.

Weights in use are 400, 500 and 600. Numbers that line up (step numbers, amounts, timings) use tabular figures.

### Named Rules

**The One Serif Job Rule.** STIX Two Text names things: h1, h2, the wordmark, a Company on its card, a side in the comparison, and the numeral of a step on the rail. Nothing else, and never in italic, which is not loaded. Buttons, labels, captions, figure text, table column heads and every other h3 are Hanken Grotesk.

**The Whole Step Rule.** A new size is one of the recorded steps. Half-pixel sizes are gone except mono's 12.5px on the site; a value between two steps is a stray, not a new step.

**The Sentence Caption Rule.** A figure's caption is one or two plain sentences in muted 14px sans that say what the figure shows. It carries no number and no label, and the copy never refers to a figure by number. There are no uppercase labels and no letter-spaced small type anywhere in the system.

## Layout

A single centred column, 1120px wide at most, with a gutter of clamp(20px, 4vw, 40px). The bar and the footer share those edges. Sections are stacked with clamp(64px, 8vw, 104px) of padding above and below and a 1px hairline between them; inside a section the head, the figure and any note sit clamp(32px, 4vw, 48px) apart. A section head is an h2 over one lead paragraph, left-aligned and held to 68ch.

Two-part compositions are unequal: the home hero is 5fr text to 6fr figure, a step on the rail 5fr words to 6fr screen, the comparison 22% for the side and 39% for each sentence, the `/developers` hero 6fr to 5fr, and the ruled two-column sections on `/developers` 0.85fr to 1.15fr. The one even split is "What the AI can never do", four points beside the matrix. Repeating content sits on a real grid: five columns for the spectrum, two for the five Company cards (24px apart; the fifth keeps one column's width, alone on the last row), and in the footer a 5fr paragraph beside three 2fr groups of links.

Where each surface sits:

- **Home (`/`):** hero (h1, a lead that introduces Iris by name, one action and nothing beneath it) with the sequence; "Today it is all or nothing" with the spectrum; "How it works" with the flow diagram above a rail of three numbered steps, each with its screen beside it; "What each side gets" as the comparison, three sides by two columns with one sentence per cell; "Try it in five industries" as five Company cards, each headed in the Company's own colour and showing the exact change the visitor would approve; "What the AI can never do" as four points beside the who-does-what matrix; a closing row with both actions; the footer with one paragraph on independence and three groups of links.
- **`/developers`:** a hero with one action (the playground) and the pairs (two ways to test, drawn as two pairs of parties); "Test a Company with Iris" as a paragraph beside a ruled fact list; the five test Companies as a ruled table of four columns (the Company, its host as a link to its site, its scopes, and a Connect link into the playground) under a sentence that names the two customers every Company shares; "Bring your own agent" as a ruled table; "What the lab implements" as a ruled list with spec references.
- **`/learn`:** a 220px sticky list of pages beside an article held to 72ch, prose at 66ch, tables, code and drawn figures at the article's width. The list has the Overview alone at its head and then four titled groups, one for each kind of page (Follow a process, Understand, Build, Look up), so a reader knows from the rail what kind of page they are on. A page with a walk-through widens its article to 780px, the width of the playground's working column, so a screenshot shows at the size it was taken; its prose keeps the 66ch measure.
- **Playground:** a full-width header on the home's edges, then a 780px working column. The workspace fills the viewport and only the transcript scrolls; the conversation closes 24px above the window edge (12px on phones, plus the safe area).

Responsive behaviour:

- **960px:** two-column compositions become one column. In the hero the figure follows the actions. The bar keeps the wordmark and the demo button and drops its links. The flow diagram swaps to an upright drawing of the same parties and connectors, because the wide one would scale its labels below a readable size; the spectrum becomes rows with a 44px swatch at the left. On the rail each step's screen drops under its words and the rail stays at the left. The comparison drops its column heads and stacks each side: the serif name, then its two sentences, each under its own label ("Without a protocol" in muted, "With Poppy" in green semibold), with a 1px ink rule opening the first side. The Company cards stack. The footer sets its paragraph across the top and its three groups in three columns. The who-does-what matrix stays a table at every width, below its points.
- **900px:** the `/learn` page list becomes a wrapped row above the article.
- **860px:** the Companies table on `/developers` becomes stacked rows with its column names as labels.
- **640px:** the endpoint table on `/developers` becomes stacked rows.
- **520px:** body drops to 16px, the bar button shortens to "Live demo", the footer's groups fall to two columns, the sequence's party heads tighten to 14px and its labels to 13px, and the playground header becomes one 56px row.
- **380px:** the sequence's labels drop to 12px so each still fits on one line.

### Named Rules

**The Same Drawing Rule.** A figure is never hidden on a small screen. It is redrawn upright or restacked with its labels, and carries the same facts at every width.

## Elevation & Depth

Flat. No surface casts a shadow, on the site or in the playground. Depth is carried by the hairline, by the single solid ink node, and by the two washes that mark state. `box-shadow` appears only as a drawn line: a 2px inset rule under the current nav item or tab, and a 1px ring on a quiet pill and on the amber dot of the who-does-what matrix. The sticky bar separates from the page with a 1px bottom rule.

### Named Rules

**The Flat Rule.** If a surface needs to stand apart, give it a 1px border in `line-strong`. A blur, an offset or a glow is never the answer here.

## Shapes

Small, consistent corners and thin strokes. Controls, inputs and figure nodes take 6px. Panels that stand for something on a screen (the three step screens, the approval row, code blocks) and the Company cards, on the home and in the playground, take 8px; a home Company card clips its coloured band to those corners. The playground conversation takes 10px. Small marks take 3 to 5px (the focus ring, a checkbox, a pill, an SVG tag). Circles are reserved for state and order: the waiting dot, the tick, the dots of the who-does-what matrix, the 44px stops of the steps rail, the guide's step number. The count of items that need the person and the "Direct, without Iris" mark are full pills.

Strokes are 1px for rules and borders, 1.2px for node outlines and 1.5px for connectors, for the steps rail and the ring of its stops, for a checkbox outline and for the dash that means "not this one" in the matrix. A request is a solid line and a reply is a dashed one (5 on, 4 off in the SVG). Arrowheads are small solid triangles in the connector's colour. The flow diagram is drawn on a 4px grid with 8px elbows. A dashed node outline means "the side you bring" on `/developers`. Diagonal hatching in tint is used once, for the two steps without a protocol in the spectrum.

### Named Rules

**The Ink Opens, Hairline Divides Rule.** A list, table or column of rows opens with a 1px rule in ink and separates its rows with 1px hairlines. Column heads sit above a `line-strong` rule, which turns green over the "With Poppy" column. The comparison has column heads on wide screens and takes the ink rule once it stacks.

## Components

### Buttons

- **Shape:** gently squared (6px), 46px tall, 18px side padding, 16px semibold; the small size is 40px tall with 14px padding and 15px type.
- **Primary:** petrol green with paper text and a matching 1px border. Hover deepens to `green-deep` over 160ms on the system's one easing curve (cubic-bezier(0.16, 1, 0.3, 1)); pressed keeps `green-deep` and moves down 1px. Often carries a trailing 18px arrow.
- **Ghost:** paper with ink text and a `line-strong` border; hover turns the border ink.
- **Dark:** ink with paper text; hover lightens to `ink-soft`.
- **Focus:** every focusable element takes a 2px green outline, offset 3px on the site and 2px in the playground.
- **Playground:** Connect, sign-in, approval and send use the same green at 44px (send is a 34px square with an icon). Secondary actions use the ghost treatment at 44px. A disabled send button is tint with muted ink.

### Navigation

- **Bar:** sticky, paper, at least 64px tall, 1px hairline beneath. The wordmark "Poppy Lab" in serif 600 at 21px on the left, six text links in muted 15px on the right, then a small primary button. Hover turns a link ink; the current page is ink, semibold, with a 2px green rule beneath. On the home the same mark follows the reading: the link of the section that lies under a line 120px below the top of the window is marked (`aria-current="location"`), and none is marked above the first section or in a section the bar doesn't link to. Each link holds the width of its semibold form, so the row doesn't shift as the mark moves (`bar-nav.tsx`).
- **Playground header:** 72px, the same wordmark, and four views (Playground, Inspector, Identity, History) as text tabs with the same current-item treatment. One 56px row with compact 12px tabs at 520px and below.
- **Learn pages:** a vertical list on a 1px left hairline, in four groups under 14px semibold ink titles (Follow a process, Understand, Build, Look up) with the Overview above them, untitled; the current page is ink, semibold, with a green left rule. In the wrapped row below 900px the current page takes a 2px green underline. A section's own pages are listed under it on the same rail, in 14px and indented 28px, while the reader is in that section.
- **Footer:** tint ground with a hairline above, 56px of padding, soft-ink 15px text. On the left the wordmark over one paragraph (46ch) that states the lab's independence, its non-affiliation with the protocol's authors and that it claims no conformance or production security, and under it one signature line in muted 14px: "With ♥ by @mpuig", the heart a 14px filled mark in the same muted ink and the handle a soft-ink link to x.com/mpuig, underlined at rest in a strong hairline. It is the one link that leaves the lab without the up-right arrow, because it signs the page and is not a destination. Then three titled groups of links: "Poppy Lab" (Playground, Learn, Developers, Source on GitHub), "Demos" (the five Companies) and "Protocol" (Specification and Community demos, both opening in a new tab). A group title is 14px semibold ink; links sit 10px apart in soft ink with no underline, and turn ink and underlined on hover. Links that leave the lab carry a 14px up-right arrow. The paragraph takes 5fr and each group 2fr; three columns under the paragraph at 960px and below, two at 520px and below.

### Figures

Every figure is a `figure` with a `figcaption` (the comparison is a plain table under its section head), drawn in ink, hairline and green, with amber only under the Amber Is Yours Rule. None is numbered. Parties keep one look everywhere: You is the solid ink node, the agent is outlined on paper, the company is outlined on tint.

- **Sequence (`sequence-figure.tsx`):** three party heads over three `line-strong` lifelines. Each message is a 52px row: a numbered label on a paper ground above a 1.5px green line with an arrowhead, dashed for replies. The fifth row is the approval gate: an amber-bordered, amber-wash row with "Waiting for your approval" and a working Approve button. Messages 6 and 7 are drawn in `line-strong` and muted until approval. Approving turns the gate to green wash with a tick and "Approved by you", draws the last two messages, and removes the button from the gate. A quiet "Show it again" (36px, hairline, paper) then appears in the caption, at the right of its sentence, and the caption keeps its height either way. Focus follows from Approve to "Show it again" and back.
- **Motion:** the only authored motion in the system. Each message line draws from its sender over 520ms and its label settles from 35% opacity, staggered 150ms apart, once on arrival and once more each time the visitor presses "Show it again", which draws the sequence again from its first message. It runs only when the visitor has not asked for reduced motion; otherwise everything is shown at rest.
- **Spectrum:** five columns under two group labels. "Without a protocol" steps are a hatched tint swatch with soft-ink titles; the three "With Poppy" steps share one green rule and step through the petrol ramp.
- **Flow diagram (`flow-diagram.tsx`):** inline SVG, three nodes and orthogonal connectors. The two things only the person does sit on amber tags (amber wash, 1px amber border, 4px corners) placed on the connector. A wide drawing above 960px, with 15px labels, and an upright one below, where the sign-in tag takes two lines ("2 · You sign in" over "at the company").
- **Steps rail:** under the flow diagram, the three steps are an ordered list drawn as a vertical rail. Each stop is a 44px circle with a 1.5px green border on paper and a green serif numeral; a 1.5px `line-strong` line runs from 8px under one stop to 8px above the next. Beside the stop sit the step's title (h3) over one 17px soft-ink paragraph held to 44ch, and beside those the step's screen panel (460px at most): words 5fr, screen 6fr, steps 40px apart. At 960px and below the screen drops under the words and the rail stays at the left.
- **Comparison ("What each side gets"):** a table of three sides (People, Companies, Agent builders) by two columns. The column heads are 14px: "Without a protocol" in muted over a `line-strong` rule, "With Poppy" in green semibold over a green rule. Each row head is the side's name in the 26px serif; each cell is one sentence, the "without" sentence in muted 17px and the "with" sentence in ink 18px, so the protocol's side reads first. Rows are divided by hairlines with 26 to 28px of padding. It holds no marks, rings or key. Stacked at 960px and below, each sentence carries its column's name as a label.
- **Who-does-what matrix ("What the AI can never do"):** five jobs as rows, the three actors (The AI model, Plain code, You) as columns. Column heads are semibold 14px, centred, over a 1px ink rule; row heads are soft-ink sans at 15px on hairlines; each cell holds one mark with its meaning as screen-reader text: a 12px green dot for the model's and the code's jobs, an amber dot with a 1px `amber-deep` ring for the person's, a short `line-strong` dash for none. Four points sit beside it.
- **Pairs (`/developers`):** two rows of party, green arrow, party.

### Walk-throughs (`/learn`)

A process is told as a list of steps (`learn-steps.tsx`), built from the page's own Markdown and shown one at a time. The list opens with a 1px ink rule; under it a bar stays in reach below the site bar while the step scrolls: the count ("Step 3 of 11", 15px semibold ink) on the left, and on the right a quiet text control ("Show all steps") beside a small ghost Previous and a small primary Next with its arrow. A disabled control is tint with muted ink. Each step is its title (h3), one screenshot and a few plain paragraphs, with what travelled between the agent and the company folded under a `details` line. The left and right arrow keys move between steps, each step has its own address, and without scripts or in print every step shows in order. Steps swap without motion.

- **Drawn figure:** a diagram on a Learn page is an SVG file in `apps/playground/public/learn-media/diagrams/` embedded as an image (so GitHub shows it too) and set into the page by the renderer, so it takes the page's typeface. It is drawn as the home's figures are: You the solid ink node, the agent an outline on paper, the company an outline on tint, requests solid and replies dashed in green with solid triangular arrowheads, amber only on what waits for the person or what only the person does, 15px labels. It has no border and no panel, a caption under it by the Sentence Caption Rule, and a name for assistive technology from the image's alt text. The wide drawing is 720 units, shown at no more than that; under 640px a `name.narrow.svg` of 360 units, shown at no more than 400px, takes its place with the same facts on shorter lines. Drawings use plain attributes, no ids or classes, so several can share a page.
- **Screenshot:** a `figure` at the article's width with a 1px `line-strong` border and 8px corners, captured from the live lab at twice the size it is shown. A capture of the conversation sits on the playground's tint ground. Its caption follows the Sentence Caption Rule.

### Screen panels

A bordered panel (1px `line-strong`, 8px corners, 16px padding, 14px type) is used only for something the person would see on a screen: a discovery file, a Company's sign-in page, a proposal waiting for approval. Its head is a semibold line over a hairline. Inside it, a small pill (30px, 5px corners) stands for a button and is not interactive, so it never takes the green of a working control: the main one is tint with a hairline ring and ink text, the other is muted text alone. A 16px checkbox mark is soft ink when ticked.

- **Waiting mark:** an 8px amber dot before "Waiting for you" in ink, weight 500.
- **Change line:** the old value struck through in muted, a 14px green arrow, the new value in semibold ink. When there is no old value the new one stands alone.

### Company cards (home)

The five Companies are the one place where the page borrows colour. Each is a card (1px `line-strong` border, 8px corners, paper, no shadow) whose header band is filled with that Company's own colour under the Company's Own Colour Rule.

- **Header band:** 18px by 24px of padding; the name in the 26px serif in paper, the sector at 14px in a tint of paper mixed with the brand, on one baseline and wrapping when narrow.
- **Body:** 24px side margins. The sentence to ask, in quotation marks, at 19px medium; then the change the visitor would approve; one 16px soft-ink line on what it shows; a small primary button ("Try this request") with a text link to the Company's site. The card says nothing of the test customers; they are on `/developers`.
- **The change:** ruled, not boxed, because it already sits inside the card: hairlines above and below, a muted 14px head ("What you approve") with the waiting mark at its right, then one row per changed thing at 15px, the thing in soft ink at the left and the change line at the right in tabular figures.
- **Hover:** the card's border takes the Company's colour over 160ms. The button stays petrol green on every card.

### Ruled lists and tables

- **Points:** 16px rows on hairlines under a 1px ink rule, with a semibold ink lead-in and soft-ink text, one sentence or two each.
- **Fact list:** a 120px muted term beside a medium-weight value; links to endpoints are mono.
- **Tables (`/developers`, `/learn`):** muted 14px column heads, semibold row heads, 13px vertical padding, hairline rows, mono for codes and spec sections. Wide tables scroll sideways inside a thin scrollbar or stack: the Companies table below 860px, the endpoint table below 640px.
- **Code (`/learn`):** inline code on tint with 4px corners; blocks on tint with a hairline border and 8px corners. A block wraps at its own edge (`pre-wrap`, a long token breaks anywhere) and never scrolls sideways, so indentation and spaces are kept and nothing is hidden.
- **Colour on code (`/learn`):** one of the site's own inks for each kind of token and no other hue, so colour says what a piece of code is and never decorates it: names (a JSON key, a header, a tag) in ink at 500; values written as strings and an attribute's value in petrol green; numbers, literals and attribute names in soft ink; punctuation and comments in muted; the method of a request and the status of a response in petrol green at 600. Every pair keeps at least 5.5:1 on the tint and on the green wash. It is done at build time on the site's own Markdown, for `json`, `http`, `xml`, `sh` and `ts`; a block in any other language (the `text` of an activity log) stays plain ink.
- **Annotated code (`/learn`):** a block whose lines carry numbered notes (`// (1)` at the end of a line, `# (1)` or `<!-- (1) -->`) has the line a note is about on a green wash and a ring in the left margin, the 22px ring of a stop on the steps rail with a green 13px numeral. The ordered list right after the block is its legend: ruled like a list of points (a 1px ink rule on top, hairlines between rows), each row opening with the same ring and a lead-in in semibold. The marks are not text, so selecting the block copies the code and nothing else, and the comment that wrote each note is not shown. A block with notes and a legend that don't agree, one to n in order, does not build. On phones the margin narrows to 42px.

### Inputs (playground)

- **Style:** 44px, paper, 1px `line-strong` border, 6px corners, 14px type, a 13px semibold label above.
- **Focus:** the border turns ink and the green outline appears.
- **Composer:** a borderless textarea inside the conversation, above a hairline, with the green send button.

### Playground workspace

The same world in Operate mode. `playground.css` restates the tokens on `:root`. The page ground is tint and the working surfaces are paper, so the conversation reads as the place where the work happens; the discovery document in the Inspector is a paper block with a hairline border for the same reason.

- **Conversation:** the one bordered object (1px `line-strong`, 10px corners, no shadow), with a hairline under its heading and above the composer. Messages are separated by hairlines and headed by a 13px semibold label, muted for Iris and ink for the person.
- **Guide:** four steps above the conversation (Pick a company, Sign in, Ask for a change, Approve it), each under a 2px rule with its number in a 20px circle. A finished step is green, the current step is amber, the rest are hairline and muted; one sentence below says what to do now.
- **Company cards:** a new conversation opens on five cards (the name with its sector beside it, a request to try), 8px corners and a `line-strong` border that turns green on hover.
- **Needs you:** a tint bar at the foot of the conversation with the count in an amber pill. One waiting card is open at a time, below the closed lines of the others; a closed line names its amount after its state. When the open card is taller than the panel, its foot stays at the panel's foot on the same tint, above a hairline, while the terms scroll behind it: Approve and Decline, and above them the amber-wash note that says why the card still waits, when there is one. Where less of the card shows than that foot needs, the row of buttons stays at the edge and covers the note. In a window up to 1100px tall the panel has no scroll of its own: the workspace grows past the window, the card is shown whole, and the foot stays at the window's foot while the page scrolls. A live Direct Conversation bar turns amber wash with an amber rule above.
- **Inspector, Identity, History:** ruled lists. Section headings are 18px semibold over a 1px ink rule, rows on hairlines, timings and spec references in muted mono, passed checks in green and failed ones in red.
- **Operation review:** a proposal's headline value at 26px. Money rows are two equal columns 58px apart, so each amount starts where the After column of the change above starts, in tabular figures with a hairline above the total; what the Company said sits behind a 2px hairline at the left. A finished operation's closed entry carries its outcome under the title at 14px: the Company's result behind the same hairline, then who approved or what to do next in muted ink.
- **Errors:** an error is a block with a drawn alert icon in error red, a rule and a wash mixed from the same red, and the message in ink at 14px. In a running conversation it closes the transcript, next to the composer; before a Company is picked it sits above the Company cards, next to the address form that caused it.
- **Exact terms and raw documents:** mono text in a paper block with a hairline border and 6px corners, so it reads as a document on the tint ground.
- **Disclosures:** every `summary` opens with the same drawn 14px chevron in the text's colour, in place of the browser's marker; it turns a quarter when open.
- **Motion:** 160ms colour transitions, the chevron's turn and a spinner while work is in flight. Reduced motion removes all animation.
- **First visit:** the playground starts in demo mode with no model or key, and the model row offers "Use your own model". The address form appears only for another Company's address or to change Company. Each conversation has its own address; its heading carries its state and a "New conversation" link, and an ended one shows a ruled note and a disabled composer. History lists the visitor's conversations (Company, first request, start time, Open or Read-only) above "Start the demo over", whose reset asks once more before acting.

### Content and vocabulary

- The protocol is "Personal Agent Protocol" or "Poppy", never its three-letter abbreviation. The agent is Iris, introduced once per page: by name in the home's lead ("with one agent, called Iris, and five fictional companies") and as the lab's Personal Agent on `/developers`; general explanation says "your agent".
- The home writes "personal agent" and "company" in lower case; `/developers` and the playground capitalise the specification's defined terms.
- `site-chrome.tsx` holds the bar, the footer and the Company data that the home and `/developers` both render, including the exact change each Company shows and its leading colour (`brand`). Company addresses come from `NEXT_PUBLIC_*_URL`; a link to `/playground?company=…` connects straight away when it names one of the lab's own Companies, and any other address only fills the form.

## Do's and Don'ts

### Do:

- **Do** give each claim one figure with a plain sentence caption in muted 14px sans, and name a figure by what it is, never by number.
- **Do** keep amber for what waits for the person or what only the person does, as a thin rule or border on amber wash, a small dot or a count mark.
- **Do** use green for the primary action, for connectors, and for the protocol's side of a comparison.
- **Do** open a list or table with a 1px ink rule and divide its rows with hairlines.
- **Do** draw You as the solid ink node, the agent as an outline on paper and the company as an outline on tint, in every figure.
- **Do** draw requests solid and replies dashed, with solid triangular arrowheads.
- **Do** keep a bordered 8px panel for something the person would see on a screen, and for a Company's card; inside a card, rule the exact change the visitor would approve instead of boxing it again.
- **Do** head a Company's card in that Company's own colour, with the name in paper serif, and keep its button petrol green.
- **Do** write a comparison as one sentence per cell, the "without" side in muted and the "with Poppy" side in ink under a green head.
- **Do** draw a sequence of steps as a rail: a 44px green-ringed stop with a serif numeral, a 1.5px `line-strong` line to the next.
- **Do** redraw or restack a figure for narrow screens so it carries the same facts.
- **Do** keep a 2px green focus outline on every focusable element and show everything at rest under reduced motion.

### Don't:

- **Don't** cast a shadow, blur a surface or use a gradient; `box-shadow` is only ever an inset 2px rule or a 1px ring.
- **Don't** use amber as decoration, emphasis or a general warning colour.
- **Don't** use a colour outside green, amber, error red and the neutrals, except a Company's own colour on the header band and hover border of its card.
- **Don't** set buttons, labels, captions, figure text or an h3 other than a Company's name in the serif, don't set the serif in italic, and don't set a heading in the sans above h3.
- **Don't** number figures, label a caption, or refer to a figure by number in the copy.
- **Don't** use uppercase or letter-spaced labels; small type is sentence case at 14px in muted.
- **Don't** wrap prose in a bordered or tinted panel to group it; rules and whitespace do that. The bordered card belongs to a Company.
- **Don't** fill a section with a colour band; tint belongs to the company party, code, the footer, the playground's ground and its quiet bars, and a Company's colour stays inside its card's header.
- **Don't** add motion beyond the sequence drawing itself once and 160ms state transitions.
- **Don't** hide a figure on small screens.
- **Don't** resemble personalagentprotocol.org closely enough to imply affiliation, and don't drop the footer's paragraph on independence, non-affiliation and no claim of conformance.

## The five fictional Companies: what they share

Each Company keeps its own visual world (below), because they stand for different businesses and the demo is only convincing if one agent works across sites that look nothing alike. Three things are the same on all five:

- **The demo strip (`labBarHtml` in `pap-core`):** a thin graphite band (`#171a1f`, Poppy Lab's ink, with the word "Demo" in the lab's amber) above the Company's own header on every public and account page: "Demo · {Company} is a fictional company in Poppy Lab. Nothing here is real.", with "Try it with an AI agent" (the playground with this Company prefilled) and "What is this?" (the lab home). It carries its own inline styles and a system font, so it never borrows the Company's identity, and it has no script. Because the strip says the site is fictional, headers no longer carry "Fictional test Company · Poppy 1.0" tags.
- **The Company's own voice:** home pages speak as the business would (a shop front, a menu, a bank, an airline, a utility) with real content from the same data the APIs serve. Each has one section that announces personal agents the way a real company would ("Shop with your personal agent"), with a "Try it with Iris, the demo agent" action. Endpoints, scopes, spec sections and test customers live on `/for-agents`, which all five now have.
- **How it works (`/how-it-works`):** every Company has this page in its menu, last, and its home links to it ("See each step as your agent sees it"). It shows a visitor three steps, each as words beside the real thing (4/7; one column at 1000px and below, the words staying in view while a long thing scrolls past): the discovery document as `/.well-known/poppy.json` serves it, on the Company's darkest ground in mono, with its parts numbered in the Company's accent and the same numbers heading a legend; the API's operations grouped as "Open to anyone", "After you sign in" and "Needs your approval"; and one change waiting for approval, drawn as that Company's own paper, beside a sequence diagram (three lifelines, six level messages each labelled on its own ground, replies dashed, a dashed band where the change waits, the customer's approval as the one arrow in the accent; drawn 640 and 360 units wide and swapped at 640px). Six questions follow in two columns. The paper never carries Approve or Decline buttons, because the customer approves in the agent: it says "Waiting for your approval" and "You approve or decline in your agent." The document, the operations and the example are built from the objects the endpoints serve and the seeded customer, and a test in each Company holds the page to them. The layout and the three readers of those objects are shared (`packages/pap-core/src/how-it-works.ts`); the words, the paper and the look are each Company's own. A list too long to show whole (Harborline's sixteen permissions) is said in words on its line, in italics, and the panel's head says so and links to the whole file.
- **Code:** Lantern, Northwind and Fernwick set code in their own mono face (Sometype Mono, Azeret Mono, IBM Plex Mono). Juniper and Harborline load none and use the system stack (`ui-monospace, SFMono-Regular, Menlo, monospace`) for code, paths and the discovery document.
- **Consent (`/oauth/authorize`):** the five consent pages are one sheet in five skins (`packages/pap-core/src/consent-sheet.ts`). From the top: the demo strip without its links; the Company's header with its name and no menu, so nothing leads away from the decision; the title "Iris wants to connect to your Harborline account" in the Company's display face, on two lines at most; and a line naming the agent, its host and "address verified". Then two columns, 5/7, under a rule: "Sign in as", the two test customers as radio cards with one line of their own data (the chosen one outlined in the Company's accent), the password field when the deployment has one, and whatever is chosen with the person (Harborline's accounts to share); and "What Iris may do", in groups: "Read · without asking you again" as plain sentences, "Propose changes · each one waits for your approval" as ticked checkboxes, and a further group only where a Company has one ("While you're away" at Harborline). A foot row holds one sentence ("Nothing changes when you allow." and where to take the permission away) and the same two buttons everywhere, "Don't allow" (quiet) and "Allow", at 48px. One line of small print carries the Company's notice that nothing is real. No scope identifier and no protocol term appears. One column at 760px and below, the people first, the buttons side by side at full width. No script: the consent Content-Security-Policy allows none.
- **The same two people:** every Company has the same two test customers, Elena Maren (listed first) and Robin Ito, so a visitor is one person with one agent at five companies. Their account IDs are `elena` and `robin` everywhere.
- **Plain account pages:** sign-in says there is no password and nobody's identity is checked; the page shows "Signed in as …, a test customer"; proposals are approved "in your agent"; grants are "connected agents" that can be disconnected. Entity versions, internal IDs and timestamps in the viewer's time zone are not shown.

- **Agent records:** "Your agent's activity" and "Feedback from agents" use one row grammar (`.records` > `.record`): a state tag, the proposal or reported task as the title, the result or description as quieter body text at 65ch, and small metadata (the agent's host, a UTC time for reports). Tags carry tone, not icons: `pending` (awaiting approval) takes each site's action colour, `done` its healthy state, `info` (an alternative offered) a quiet tint, and `muted` (expired, received) only an outline. Each site draws the tag in its own lettering: Lantern's embossed mono labels, Harborline's notice-board capitals, Northwind's briefing codes and Juniper's soft grocer's labels with serif titles.

The footer keeps each Company's fiction notice and the shared "Part of Poppy Lab" line.

## Northwind Air website: synoptic route chart

Northwind Air (`apps/northwind/src/site.ts`) is a fictional airline site and account portal built as a working weather-route briefing rather than a destination-photo template. The search form opens `/flights`, a results page for people built from the same search the API uses; times are airport local time.

- **Palette:** pale chart sky `#dbeaf0` and paper `#f7f4ea`; pressure ink `#102a38`; route blue `#1d6882`; weather-line blue-gray `#91aab4`; sun yellow `#efb73e` for committed actions; restrained red and green for errors and current state.
- **Type:** Barlow Condensed for compressed operational headings, Figtree for readable interface prose and Azeret Mono for flight numbers, times, prices, scopes and status. The site and consent CSPs allow only Google Fonts' stylesheet and font origins.
- **First viewport:** curved isobars and one dashed route fill a pale chart field. A large, compact headline sits left; a real origin/destination/date search form sits right and submits to the signed-out flight-search API. The no-real-ticket notice remains visible in the offer, not buried in the footer.
- **Structure:** a dark three-part capability band follows the search; a ruled departure board uses the same schedule and prices as the APIs; travel information is a varied three-column passage; the final yellow strip sends visitors to Iris. `/for-agents` uses the same typographic chart language for endpoints, scopes and personas.
- **Account:** the portal is a precise Operate surface: an unequal trip/sidebar grid, ruled segment rows, loyalty and preferences as compact facts, agent activity below the trip, and connected grants on demand. It polls the same tenant state every two seconds and never presents a pending proposal as completed.
- **Consent:** the shared sheet under a 2px ink rule, with the passengers' names in the display face over their booking reference in mono, "address verified" as a sun tag, and the site's own ink and outline buttons. Requested read scopes appear as "Flights and fares", "Your trips" and "Your profile"; a write request has one ticked option, "Your trips and preferences", whose sentence lists what the requested scopes cover.
- **Responsive behavior:** the hero becomes one column, the dark capability band becomes stacked rows, departure times yield before route/fare data, and the account sidebar follows trips. Controls keep 50px targets and focus uses the sun-yellow chart mark.
- **Motion:** no decorative animation is required; state change is the portal's live refresh. The route chart remains legible with reduced motion because its diagram is static.
- **Content rule:** schedule, fares, personas, booking references, loyalty balances and notices come from `data.ts` and the same business projection used by OpenAPI routes. Every surface says the data is fictional and that no real ticket is sold, changed, cancelled or charged.
- **How it works (`/how-it-works`):** wind-blue display numerals; the document on the ink panel with a sun-yellow foot rule and sun marks; the operations as three departure boards (a display number, the operation in caps, its path in mono, and a tag: outlined "open" or "read only", sun-filled "your approval"); the change as a page of the trip (sky head with the flight and its departure, the route, the fare struck through beside the new one on sun, the price, the refund terms, a sun "Waiting for your approval" tag). On phones the header's four links sit in one row under the name.

## Lantern Noodle Bar website: ticket machine

The fictional noodle bar's read-only site (`apps/lantern/src/site.ts`): home (menu, slots, how ordering works, hours), `/how-it-works`, `/for-agents`, and the consent page, all server-rendered with no JavaScript. The world is the shokkenki ticket machine at a ramen shop's door.

- **Palette:** warm wall `#f3efe6`; a navy machine panel `#17202a`; cream button tiles `#fbf7ee` with an amber edge light `#e4a11b`; red `#c62f1e` only as the header strip; rules `#d9d2c5`.
- **Type:** Big Shoulders Display (700–900, uppercase) for the name, headings and button labels; Manrope for prose; Sometype Mono only for prices (as embossed black labels), codes, times and the header tag. Fonts load from Google Fonts; the page and consent CSPs allow exactly those two origins.
- **Composition:** red strip with the wordmark and four links (Menu, For agents, Your account, How it works), which drop under the wordmark in one row on phones; a 14ch headline; the machine panel with six dish buttons (3×2, numbered, name and price), four slot buttons (day and time) and a darker "tray" with the explanation and an amber "Order through your agent" link to the playground; then three-column sections (how ordering works, with a mono link to `/how-it-works`; kitchen hours, slots, address) and a navy footer with the disclaimer. Two columns per row on phones.
- **Consent:** the shared sheet with the red strip above it, caps display heads, the customers as cream tiles whose chosen one takes the amber edge light, "address verified" as an embossed black label, and the navy and outline buttons.
- **Account area:** sign-in form as a white card; each order as a cream tile with the amber edge light, dish lines and totals with mono prices, a dashed-rule editor (slot select, quantity grid), and quiet secondary buttons; activity and connected agents as ruled lists.
- **How it works (`/how-it-works`):** headed "How Lantern works with your agent." in the display face at up to 84px on two lines; red display numerals `01`–`03` and caps headings. The document sits on the navy panel in mono with amber keys and amber marks. The API is the machine: three zones laid out as one 3×2 grid of cream button tiles, numbered, each with the operation's name, its method and path as an embossed black label and the first clause of its summary; only the operation that proposes a change carries the amber edge light. The change is a cream ticket in mono (dashed tear line, the moved slot and the added dish on amber, the old total struck through, an amber "Waiting for you" stamp). Questions take caps display headings.
- **Content rule:** the dishes, prices, slots and customers on the page come from the same `data.ts` the API serves; the discovery document, the operations and the example change of `/how-it-works` are built from the objects the endpoints serve, and a test holds them together.

## Harborline Bank website: tide ledger

Harborline's public site, consent page and customer portal (`apps/harborline/src/site.ts`, `portal.ts`) use a daylight harbor master's ledger as an information system, not maritime decoration. The landing page is Persuade; consent and the portal are Operate.

- **Palette:** chalk paper `#f4f7f5`, white working sheets, channel blue `#073b5c` and deep blue `#062b43`, buoy orange `#ed6b2f` for the primary action and safety band, sea-glass `#b8ddd4`/`#1f6e65` for healthy state, and `#a7352c` only for warnings. Thin blue-grey rules keep the dense records legible.
- **Type:** Barlow Condensed (600–800, uppercase) gives the bank name and headings the compressed lettering of a harbor notice board. Public Sans carries prose and controls. Native tabular numerals carry money; monospace is reserved for scopes and endpoints.
- **First viewport:** a compact blue masthead above a two-column composition. The left names the Poppy 1.0 banking proposition, explicit no-real-money/no-real-data warning, and the connect/portal actions. The right is a full fictional customer ledger showing two owned accounts, a transaction, a card status and budget progress from the same seed the APIs serve.
- **Structure:** capabilities are ruled manifest rows rather than equal cards: read-only records, reversible organization/card changes, and irreversible payment/transfer requests. Persona summaries are two joined ledger panels. The `/for-agents` page uses the same manifest grammar for scopes and protocol runs.
- **Consent:** the shared sheet under a 3px channel rule, with white radio cards, "address verified" beside a glass status dot, and channel buttons. Every requested read permission is listed with its sentence, each reversible or irreversible change has its own ticked option, and "While you're away" holds the one option that is off by default, which says how long the agent stays connected with and without it. With FDX scopes, "Accounts to share" sits under the people: the chosen customer's accounts, ticked, with the sentence that they limit the whole grant.
- **Portal:** account balances, transactions, budgets, cards, recipients, operation activity and connected grants are flat ruled lists in two unequal columns. It polls every two seconds, exposes retry/logout states, and labels the current fictional persona. The portal and APIs read the same tenant state; pending proposals never render as committed changes.
- **Responsive/accessibility:** the hero and account grid become one column below 900px; manifest metadata moves under its description; controls retain 48px targets, visible orange focus rings and explicit loading/error status text. Selection, links and tabular figures are themed.
- **Honesty:** every surface says no real money moves and no real banking data or credentials should be entered. No real institution, payment rail or identity verification is implied.
- **How it works (`/how-it-works`):** channel-blue display numerals; the document on the deep panel under an orange top rule, with the sixteen permissions and their hints said in words and a link to the whole file; the operations as one ledger (glass strip, three sections under channel rules, each row an operation, its path in mono and a status dot: glass for "open" and "read only", orange for "your approval"), with one note under them; the change as a ledger page (the transfer's amount as the head, a row for each account with the signed amount and its balance before and after, and a note with the orange "Waiting for your approval").

## Company messages in the chat

What the Company's own agent says (§8) appears as separate transcript entries before Iris's answer. They are indented behind a 2px rule in `--line`, headed with the Company's name and "automated agent" (or the person's name) in the message label style (13px sans, semibold, muted), and marked with a small plain-text "Company content" note so they never read as Iris speaking. Structured `data` stays collapsed under a native "Data" disclosure with a bounded, scrollable mono block. A short muted note marks what the entry asked for: sign-in, or an operation to approve in the usual card below.

## Interaction and accessibility

Visible labels, keyboard focus rings, explicit loading/disabled/error states, and polite live updates remain. Enter submits a message; Shift+Enter inserts a line break. Composition events are respected for IME users. Empty-state suggestions fill the composer but never trigger paid requests automatically. Reduced-motion preferences disable activity animation.

Model settings sits above the connection row. A new conversation starts from the five Company cards, and the Company address form appears only on request. The provider and key fields stack on mobile. Account access, permission expansion, sign-out, errors and Operation widgets live inside the conversation, not above it. All views and provider choices remain accessible; long URLs and responses wrap without horizontal page overflow.

## Juniper customer website

The shop front (`home.ts`) and `/for-agents` share the account's frame: warm paper, forest green, Georgia serif headings, flat ruled sections, and one header nav (Shop, Help, For agents, Your account, How it works). The home shows the week's shelf with prices and stock, delivery terms and hours from the API's own data, and "Shop with your personal agent".

The Company account at `/account` preserves Juniper’s warm paper and forest-green identity, with restrained serif headings and flat, ruled sections. It serves the customer Operate use case: inspect the same persisted basket, recurring delivery, orders and recent agent activity. Desktop pairs basket and delivery in unequal columns; mobile stacks them. Prices use localized currency, line items are readable, order details expand natively, and polling has visible retry/logout states. Pending proposals never appear as committed account changes. The landing page links to customer login. The service foundation adds billing derived from actual fictional orders, a versioned fictional profile editor, public FAQs and a working help/case area. Support uses an unequal two-column list/form layout on desktop and stacks on mobile; messages expand natively and are labeled as automatic test responses. Optional order linkage uses actual account-order choices, not manual opaque-ID entry. Agent activity is collapsed by default to avoid turning the customer account into a protocol log. The profile pairs current contact data with an on-demand editor; drafts and opening versions stay stable during polling. Conflict copy preserves the draft and offers an explicit reload of current data. Agent profile reviews show exact name/email/address before and after, while existing orders retain historical destinations. Basket and recurring delivery now have independent on-demand quantity editors, with native bounded number inputs and a weekday select for recurrence. Editors capture their opening entity version and preserve drafts across polling; explicit reload/cancel/save controls distinguish replacing a draft from committing it. Saved totals are explicitly labeled as not previewing drafts. Neither editor creates orders. Login and Company consent now use native selectors for Elena and Robin. The customer account explicitly labels its persona and offers a switch-account link. A flat Connected agents section exposes active agent grants only on request, with scope/expiry and explicit revocation; copy distinguishes revocation from website logout. Forms are bound to their opening page account so stale tabs cannot save into another persona.

- **How it works (`/how-it-works`):** Georgia numerals in the terracotta accent, without a leading zero; the document on the forest-green panel with pale green keys and marks in the pending wash; the operations as three ruled lists in two columns (the operation in semibold, its path in mono beneath), the list that needs approval under a terracotta rule with a terracotta dot after each name; the change as a slip on the form paper (the delivery and its customer, the day struck through beside the new one on the pending wash, the items at the shelf's prices, the charge, a pending pill "Waiting for your approval"). Sequence heads are in Georgia and its labels in the sans, neither in capitals.

## Juniper consent

Juniper's skin of the shared consent sheet (see "Consent" under what the Companies share): warm paper, forest green, the title and the two column heads in Georgia, radio cards on the form paper with 5px corners, "address verified" as a green pill, a dark green Allow and a hairline Don't allow. The read list covers shopping, profile and address, billing documents and support messages; the one change option covers basket, purchases, deliveries, profile and support cases, says it confirms no purchase, and can be unticked for read-only access. Asked for write alone, the option is required and the page says nothing is read. Nonce and PKCE binding and existing grants are unchanged; declining bypasses password validation without bypassing server-side consent binding.

## Permission requests and recovery

New Poppy sign-ins request read-only access. A separate Request change permission action opens Company consent for read/write; its helper explains that the user asks for the change again afterwards and approves it separately. Existing grants are not silently changed. The Juniper consent renderer only describes requested scopes: no write checkbox for read-only, and no read claim for write-only. The account row reflects granted permissions. Polling uses a completed-consent counter, not the previous account's signed-in flag. Unavailable access, insufficient scope, expired proposals and uncertain outcomes have distinct recovery copy; unknown outcomes point to Check status rather than another purchase.

## Ample account access

The in-chat account controls distinguish Ample's real infrastructure account from Juniper's fictional personas. They name the requested servers:read and budgets:read permissions and explicitly exclude deployments, commands and credential tools. Granted scopes are shown rather than assumed. A partial grant offers Request remaining read access, not a write-permission action. OAuth stays in the Company's own consent tab; no credentials are collected in chat. MCP tools cannot confirm Operations or mutate infrastructure.

## Product honesty

Demo is explicitly labeled as having no LLM. Optional Company sign-in uses a separate Juniper consent tab and a clearly fictional account. Delivery, basket, and checkout proposals appear inside the chat with exact terms, revision, expiry, and explicit Approve/Decline/Check status controls. Still-valid saved runs restore their bounded conversation and connection on refresh. Active proposals expand to show Company summaries, before/after quantities or days, formatted prices and readable line items. Complete structured terms remain available on demand. Completed, declined and expired records are collapsed by default. Sandbox order/booking reviews include observed before/after dates, product replacements/additions, card text, rate plans and declared cancellation conditions. Missing observed prior values are labeled rather than invented; prior totals may be calculated only from the Company's declared new total and price difference, with the calculation explicitly labeled. Before snapshots have source/time provenance, are separate from Company terms and are marked unversioned when the API provides no account version. The model cannot confirm changes; completed results are shown as Company results. Only public identity metadata is linked, and protocol secrets never appear in the Inspector.
