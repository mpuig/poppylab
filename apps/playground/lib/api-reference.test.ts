/**
 * /developers/api is the API's OpenAPI document, made readable: every
 * operation, type and event of the document is on it, a route added to the
 * document is on it with nothing else changed, and what the page writes
 * itself (the error codes, the events' notes, the guide's examples) is held
 * to the document and to the core's source.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { openApiDocument } from "@poppy-lab/pap-agent/openapi";
import { spokenText } from "@poppy-lab/pap-agent/spoken";
import ApiReference from "../app/developers/api/page";
import NativeClient from "../app/developers/native-client/page";
import { exampleText } from "../app/developers/api-parts";
import { EXAMPLES } from "./api-examples";
import {
  ERROR_CODES,
  EVENT_NOTES,
  apiReference,
  eventAnchor,
  groups,
  mismatches,
  operation,
  operations,
  typeAnchor,
  type ApiDocument,
  type Schema,
} from "./api-reference";

const document = openApiDocument() as ApiDocument;
const page = renderToStaticMarkup(ApiReference());
const guide = renderToStaticMarkup(NativeClient());
/** Text as React writes it into the page. */
const escaped = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");

describe("the reference", () => {
  it("shows every operation of the document, with its anchor, method, path and summary", () => {
    const ops = operations(document);
    expect(ops.length).toBeGreaterThan(20);
    for (const op of ops) {
      expect(page).toContain(`id="${op.id}"`);
      expect(page).toContain(
        `<span class="api-method">${op.method}</span> <code>${escaped(op.path)}</code>`,
      );
      // The summary's words, with its code spans set as code.
      for (const piece of op.summary.split("`"))
        expect(page).toContain(escaped(piece));
      for (const answer of op.answers)
        expect(page).toContain(
          `<code class="api-name">${answer.status}</code>`,
        );
    }
    // Each one once, in one group.
    const listed = groups(document).flatMap((g) =>
      g.operations.map((o) => o.id),
    );
    expect(listed.sort()).toEqual(ops.map((o) => o.id).sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("puts each operation of today's document under a titled group, not under Other", () => {
    expect(groups(document).map((g) => g.id)).not.toContain("other");
  });

  it("shows every type, every member of each, and every event", () => {
    for (const [name, schema] of Object.entries(document.components.schemas)) {
      expect(page).toContain(`id="${typeAnchor(name)}"`);
      for (const member of Object.keys(schema.properties ?? {}))
        expect(page).toContain(`<code class="api-name">${member}</code>`);
    }
    // Every link to a type finds it.
    for (const [, anchor] of page.matchAll(/href="#(type-[^"]+)"/g))
      expect(page).toContain(`id="${anchor}"`);
    const types = document.components.schemas.AgentEvent!.properties!.type!
      .enum as string[];
    expect(types.length).toBeGreaterThan(10);
    for (const type of types)
      expect(page).toContain(`id="${eventAnchor(type)}"`);
  });

  it("links the document the API serves", () => {
    expect(page).toContain('href="/api/v1/openapi.json"');
    expect(page).toContain(
      `${document.info.title} ${document.info.version} · OpenAPI ${document.openapi}`,
    );
  });

  it("adds a route the document gains, with nothing written for it", () => {
    const grown = structuredClone(document);
    grown.paths["/api/v1/conversations/{id}/voice"] = {
      post: {
        operationId: "speak",
        summary: "Say it aloud.",
        responses: { "204": { description: "Said." } },
      },
    };
    grown.paths["/api/v1/elsewhere"] = {
      get: {
        operationId: "elsewhere",
        tags: ["Elsewhere"],
        summary: "A tagged route.",
        responses: { "200": { description: "Here." } },
      },
    };
    const found = apiReference(grown).groups;
    expect(
      found.find((g) => g.id === "conversations")!.operations.map((o) => o.id),
    ).toContain("speak");
    expect(found.find((g) => g.id === "elsewhere")).toMatchObject({
      title: "Elsewhere",
      operations: [{ id: "elsewhere" }],
    });
    grown.paths["/api/v2/other"] = {
      get: { operationId: "other", responses: {} },
    };
    expect(apiReference(grown).groups.at(-1)).toMatchObject({
      title: "Other operations",
      operations: [{ id: "other" }],
    });
  });

  it("writes a note for exactly the document's events, each naming members an event has", () => {
    const event = document.components.schemas.AgentEvent!;
    expect(Object.keys(EVENT_NOTES).sort()).toEqual(
      [...(event.properties!.type!.enum as string[])].sort(),
    );
    for (const note of Object.values(EVENT_NOTES))
      for (const member of note.carries)
        expect(Object.keys(event.properties!)).toContain(member);
  });

  it("names only error codes the core answers, with the status it answers them with", () => {
    const src = path.resolve(__dirname, "../../../packages/pap-agent/src");
    const source = readdirSync(src)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => readFileSync(path.join(src, f), "utf8"))
      .join("\n");
    for (const [code, status] of ERROR_CODES) {
      expect(source, code).toContain(`"${code}"`);
      expect(page).toContain(`<code class="api-name">${code}</code>`);
      // Some operation of the document answers that status.
      expect(
        operations(document).some((op) =>
          op.answers.some((a) => a.status === status),
        ),
        `${code} ${status}`,
      ).toBe(true);
    }
  });
});

describe("the native-client guide", () => {
  const bodyOf = (id: string, status: number) => {
    const answer = operation(document, id).answers.find(
      (a) => a.status === String(status),
    );
    expect(answer, `${id} answers ${status}`).toBeDefined();
    return answer!.body?.schema;
  };

  it("shows requests and answers that fit the document's schemas", () => {
    for (const [key, example] of Object.entries(EXAMPLES)) {
      const op = operation(document, example.operation);
      const ex = example as {
        request?: unknown;
        response?: unknown;
        text?: string;
        path?: Record<string, string>;
      };
      if (ex.request !== undefined)
        expect(
          mismatches(document, ex.request, op.body!.schema as Schema),
          `${key} request`,
        ).toEqual([]);
      else expect(op.body, `${key} takes no body`).toBeUndefined();
      const schema = bodyOf(example.operation, example.status);
      if (ex.response !== undefined)
        expect(mismatches(document, ex.response, schema!), `${key}`).toEqual(
          [],
        );
      // The path's parameters are each given.
      for (const [, name] of op.path.matchAll(/\{(\w+)\}/g))
        expect(ex.path?.[name!], `${key} {${name}}`).toBeDefined();
      expect(guide).toContain(`href="/developers/api#${op.id}"`);
    }
  });

  it("streams only events the document has", () => {
    const types = document.components.schemas.AgentEvent!.properties!.type!
      .enum as string[];
    const shown = [
      ...EXAMPLES.conversationEvents.text.matchAll(/^event: (.+)$/gm),
    ].map((m) => m[1]);
    expect(shown.length).toBeGreaterThan(1);
    for (const type of shown) expect(types).toContain(type);
    for (const line of EXAMPLES.conversationEvents.text.split("\n"))
      if (line.startsWith("data: "))
        expect(line).toMatch(/^data: \{"type":"([^"]+)"/);
  });

  it("streams a turn's answer in events the document has, each sentence as described", () => {
    const schema = document.components.schemas.TurnEvent as Schema & {
      oneOf: Schema[];
    };
    const text = EXAMPLES.sendMessageStreamed.text;
    const names = [...text.matchAll(/^event: (.+)$/gm)].map((m) => m[1]);
    expect(names.at(-1)).toBe("turn");
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      // The sentences are whole; the result is cut short with "…".
      if (line.startsWith('data: {"type":"message.delta"'))
        expect(mismatches(document, JSON.parse(line.slice(6)), schema)).toEqual(
          [],
        );
      else expect(line).toMatch(/^data: \{"type":"turn"/);
    }
    // The spoken forms are the core's, sentence by sentence.
    for (const line of text
      .split("\n")
      .filter((l) => l.startsWith('data: {"type":"message.delta"'))) {
      const delta = JSON.parse(line.slice(6)) as {
        text: string;
        spoken: string;
      };
      expect(delta.spoken).toBe(spokenText(delta.text));
    }
  });

  it("writes each request with the method and path the document gives", () => {
    const { request } = exampleText(document, EXAMPLES.decideProposal);
    expect(request.split("\n")[0]).toBe(
      "POST /api/v1/conversations/hKhgaC-veINpeBH3fJQO4-ewBMbIdw9j/proposals/op_4UNgDhnV1Y8lgsDmZCAV2pt3/decision",
    );
    expect(guide).toContain("ASWebAuthenticationSession");
    expect(guide).toContain("poppylab.dev");
  });
});
