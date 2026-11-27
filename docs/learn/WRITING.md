# Writing Learn pages

How the pages in `docs/learn` are written, so that all of them read as one
voice. This file is for contributors; the site doesn't publish it. It adapts
[Diátaxis](https://diataxis.fr), which sorts documentation by what the reader
needs at that moment.

## What Learn is, and isn't

Learn teaches Personal Agent Protocol ("Poppy"). Poppy Lab, with Iris and its
fictional companies, is the working example that makes each idea concrete.

Learn is not a diary of how the lab was built. A page never says what went
wrong while building, what was fixed, what a test found or what the authors
wish they had known. Those stories belong in an article. What a page may say is how something behaves:
"Harborline declines every agent approval that moves money."

## Four kinds of page

Each page is exactly one kind, and its place in the navigation says which. If a
section needs another kind, link to a page of that kind instead of including
it.

| Kind (nav group)                | The reader wants to…                      | The page                                                            | Pages today                                                       |
| ------------------------------- | ----------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Follow a process** (tutorial) | Watch one thing get done, start to finish | Walks one concrete case in order, with what the reader sees         | How it works, One task, the worked examples under extensions      |
| **Understand** (explanation)    | Know why it is built this way             | Discusses an idea, weighs alternatives, makes connections           | Poppy compared, Conversations, Approvals, Domain extensions       |
| **Build** (how-to guide)        | Get a real job done                       | Gives the steps to reach one goal, and nothing the steps don't need | Build a Company, Build a Personal Agent, Write a domain extension |
| **Look up** (reference)         | Check a fact while working                | Lists the facts, in a fixed pattern, without opinion                | Glossary, Validator results                                       |

To classify a page, or a single section, ask two questions. Does it tell the
reader what to do, or what is true? And is the reader studying, or working?
Doing while studying is a process to follow; doing while working is a guide;
knowing while working is reference; knowing while studying is explanation.

### Follow a process

Plain and concrete, in the present tense. A named person (Elena) with a named
agent (Iris) deals with a named company. One action to a step, and each step
says what happens and who decides. The person is never asked to do anything;
the steps are what the page follows.

- Opening: who wants what, and what the page follows, in two or three
  sentences. Then where the pictures or requests come from and their date.
- `## Who does what`: a table of who and what they do in this process.
- The steps. On a page for business readers they sit under `## Step by step`,
  with `### 1. Title` for each; the site shows them one at a time. A step is one
  figure, then one to three short paragraphs. Protocol detail that a business
  reader can skip is folded under `<details><summary>What travelled</summary>`.
  On a page for implementers the requests are the step and are not folded: the
  steps are numbered `## 1. Title` sections that read straight through, with a
  table of which request carries what above them.
- `## What … controls`: what the company decides in this process.
- `## For the technical reader`: links to the Understand and Build pages.
- No definitions of terms, no alternatives, no history. Link to the glossary.

Models: [Changing an order](how-it-works/changing-an-order.md).

### Understand

Discursive, in the third person. It answers one question and says so first.

- Opening: the question, then the short answer in two or three sentences.
- Sections are named for ideas ("Why an extension, and not just an OpenAPI"),
  never for actions, and never numbered.
- Weigh alternatives and say when each is the right one. Explain causes: "the
  Company writes both, so a summary could describe something the terms don't."
- An example is a few lines. The full traffic lives on a Follow page that the
  section links to.
- `## Go deeper` closes the page: the Follow page that shows it, the Build guide
  that applies it, the specification section that defines it.
- No steps to carry out, no checklists, no "Try it".

### Build

A guide to one goal, written for someone who already knows what they want.

- Title: the goal ("Build a Company"). Opening: "This guide shows how to…",
  who it is for and what it assumes, then one link to the Understand page for
  the reasoning.
- `## Before you start`: decisions and prerequisites.
- Then milestones or steps. Each opens with its goal in one sentence, gives its
  steps as imperatives ("Refuse undeclared requests with `extension_required`"),
  shows the code to adapt, and ends with `You know it works when …`, a check the
  reader can run.
- Branches are conditional imperatives: "If the Company offers only Device
  Sign-In, …".
- Give a reason in a clause and link to the Understand page for more.
- `## Check your work` closes the page with the checklist, then `## Go deeper`.
- No history, no extended rationale, no list of every option (link to the
  specification for that).

### Look up

Austere and neutral. It lists, in the same pattern every time.

- Opening: one sentence on what the page lists. Then the list.
- One pattern per entry: the term in bold and then one or two sentences, or one
  table row. Describe, don't recommend, and don't explain why.
- Link each entry to where it is used. Say what the page doesn't cover.

## Voice, for every page

- Present tense, active voice. Name who acts: "Iris sends the request",
  "Lantern answers". Avoid "is sent" and "gets handled".
- Sentences of about 25 words or fewer, paragraphs of four sentences or fewer,
  one idea to each.
- "You" addresses the reader in Follow and Build pages only. Understand and
  Look up pages use the third person: "a Company", "the agent".
- Write plain claims. Leave out "simply", "just", "easily", "powerful",
  "seamless", rhetorical questions, and sentences that announce what the next
  sentence says. Use an em dash rarely, and never two in a paragraph.
- Dates are absolute: "25 November 2026".
- Never "we", "our" or "us" for the lab's own work. When the lab is the subject,
  say "the lab" or name the company: "Lantern's gateway", not "our gateway".
- Never "at first", "originally", "now fixed", "we found", "a bug we shipped".
- Cite the specification at the first mention of a rule in a page, with a link,
  and not again for the same rule.
- Say what a page doesn't cover where a reader might expect it.

## Concision

A page is as short as it can be while a reader loses nothing but padding.

- Say each thing once. When a table, a code block or a figure carries it, the
  prose doesn't repeat it, and the page doesn't point at the figure ("above",
  "below", "the diagram shows").
- No signposting ("This page explains…", "Note that…", "As we saw"), no hedges,
  no intensifiers. An opening is at most three sentences.
- One example carries an idea. A Build page gives a reason in a clause and
  links the Understand page for more.
- A `## Go deeper` has at most four bullets, each a link and at most a clause.
- Compress phrasing, never content: every rule, field name, header, error code,
  number and limit stays, and a rule is stated once, where it is needed.
- A figure replaces the prose that narrates it. If the figure says "A sends X to
  B, then B answers Y", the paragraph that says the same goes.

## Words

- "Personal Agent Protocol" or "Poppy", never the three-letter abbreviation.
- Iris is introduced once per page. After that, "the agent" or "Iris", and
  never "Poppy" for the agent.
- Pages for business readers (the overview and How it works) say "company",
  "customer" and "her agent" in lowercase. Pages for implementers (One task,
  Understand, Build, Look up) use the specification's role names where it
  matters: **Company**, **Personal Agent**, with "agent" as the short form after
  the first mention. In both, "user" is lowercase.
- A domain extension is "FDX-shaped" or "ESPI-shaped", never "FDX-compliant".
  Say once, in one blockquote near the top, that it isn't certified.
- Field names, headers, scopes and paths are in `code`. A path or header is
  never split across lines in prose.

## Shapes

- **Code.** Fence it with a language: `http`, `json`, `xml`, `ts`, `sh`; use
  `text` only for the lines of an activity log. The site colours the code by
  language, so a block without one stays plain. Don't wrap lines by hand: the
  site wraps them, so a reader never scrolls sideways. Trim long values with
  `…`.
- **Notes on code.** When a page explains the parts of a sample one by one,
  number the parts instead of writing a table or a bulleted list under it. End
  each line the note is about with a comment holding its number, `// (1)` (in
  `sh`, `# (1)`; in `xml`, `<!-- (1) -->`), and put an ordered list right after
  the block with one item for each note, in the order of the lines. The site
  draws a mark on each line and the list becomes its legend; on GitHub the
  comment is just a comment and the list is just a list. Start an item with
  what it is about, in bold (``**`revision`** is these terms.``). The page does
  not build if the notes and the list disagree. Use it for a sample of ten
  lines or more with three or more parts to explain; a single remark stays a
  sentence.
- **No ASCII art.** A picture is an SVG figure, never characters in a code
  block (see Diagrams).
- **Diagrams.** Draw one when it shows something a paragraph takes longer to
  say: who talks to whom in what order, where a flow forks, how an operation
  ends, what sits above what. Then cut the paragraph. Put the file in
  `apps/playground/public/learn-media/diagrams/` as `name.svg` (and `name.narrow.svg`
  for screens under 640px) and embed it with
  `![What the figure shows, in full](path "One-sentence caption")`. The caption
  says what the figure shows, with no number and no label. Draw it as
  [DESIGN.md](../../DESIGN.md) says figures are drawn. A figure is
  one file in [`scripts/learn-diagrams/figures`](../../scripts/learn-diagrams/figures),
  drawn with `pnpm learn:diagrams`; `pnpm learn:diagrams:check` fails when an
  SVG is not what its figure draws. Edit the figure, never the SVG.
- **Screenshots.** As in How it works: one per step, from the live lab, with the
  date in the opening.
- **Tables.** For comparison and lookup. Never to lay out prose.
- **Callouts.** One blockquote at most on a page, for a boundary the reader must
  not miss.
- **Headings.** Sentence case. Numbers only in the steps of a Follow page and the
  milestones of a Build page.

## Before a page is done

- It has one kind, and its opening is the opening that kind needs.
- No "we", "our", history, or a "Try it" section. Anything the reader can do
  next is in `## Go deeper` or the page's last paragraph.
- No ASCII art, and no code line that needs a sideways scroll to be understood.
- Every term is the glossary's term, every rule cites the specification once,
  and every relative link works (`pnpm test` checks them).
- It stays one kind from top to bottom. Past about 2,000 words of prose
  (code not counted) it probably holds two kinds or two goals, or is saying
  something twice: split it, or cut.
