import { Fragment } from "react";
import { codeBlock } from "@/lib/learn-code";
import type { ApiExample } from "@/lib/api-examples";
import {
  fields,
  operation,
  typeAnchor,
  typeParts,
  type ApiDocument,
  type Field,
  type Group,
  type Schema,
  type TypePart,
} from "@/lib/api-reference";

/** Where the reference lives, for links from the guide. */
export const REFERENCE = "/developers/api";

/**
 * The rail beside both pages: the reference, with its sections under it
 * while the reader is on it, and the guide.
 */
export function ApiNav({
  current,
  groups = [],
}: {
  current: "reference" | "native-client";
  groups?: Group[];
}) {
  const sections = [
    ["authentication", "Authentication"],
    ["errors", "Errors"],
    ...groups.map((g) => [g.id, g.title]),
    ["types", "Types"],
  ];
  return (
    <nav className="learn-nav" aria-label="The agent's API">
      <p className="learn-nav-title">The agent&apos;s API</p>
      <ol className="learn-nav-first">
        <li>
          <a
            href={REFERENCE}
            aria-current={current === "reference" ? "page" : undefined}
          >
            Reference
          </a>
          {current === "reference" && (
            <ol className="learn-nav-sub">
              {sections.map(([id, title]) => (
                <li key={id}>
                  <a href={`#${id}`}>{title}</a>
                </li>
              ))}
            </ol>
          )}
        </li>
        <li>
          <a
            href="/developers/native-client"
            aria-current={current === "native-client" ? "page" : undefined}
          >
            Native client
          </a>
        </li>
      </ol>
    </nav>
  );
}

/** The document's own words, with its `code` spans set as code. */
export function Inline({ text }: { text: string }) {
  return (
    <>
      {text
        .split("`")
        .map((part, i) =>
          i % 2 ? (
            <code key={i}>{part}</code>
          ) : (
            <Fragment key={i}>{part}</Fragment>
          ),
        )}
    </>
  );
}

/** A type in a few words, each named type a link to its entry. */
export function TypeText({
  parts,
  base = "",
}: {
  parts: TypePart[];
  base?: string;
}) {
  return (
    <>
      {parts.map((part, i) =>
        "ref" in part ? (
          <a key={i} href={`${base}#${typeAnchor(part.ref)}`}>
            <code>{part.ref}</code>
          </a>
        ) : "code" in part ? (
          <code key={i}>{part.code}</code>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}

/** An object's members as a ruled list: name, type, and what it is. */
export function FieldList({
  list,
  base = "",
}: {
  list: Field[];
  base?: string;
}) {
  if (!list.length)
    return (
      <p className="api-note">
        An empty object, <code>{"{}"}</code>.
      </p>
    );
  return (
    <dl className="api-fields">
      {list.map((field) => (
        <div key={field.name}>
          <dt>
            <code className="api-name">{field.name}</code>{" "}
            <span className="api-type">
              <TypeText parts={field.type} base={base} />
            </span>{" "}
            {field.required ? (
              <span className="api-req">required</span>
            ) : (
              <span className="api-opt">optional</span>
            )}
          </dt>
          {(field.description || field.fields) && (
            <dd>
              {field.description && (
                <p>
                  <Inline text={field.description} />
                </p>
              )}
              {field.fields && <FieldList list={field.fields} base={base} />}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}

/**
 * A schema as the page shows it: a named type is a link, an object written
 * in place lists its members, and a choice of shapes lists each one.
 */
export function SchemaView({
  schema,
  base = "",
}: {
  schema: Schema;
  base?: string;
}) {
  if (schema.oneOf)
    return (
      <>
        <p className="api-note">Exactly one of these shapes:</p>
        {schema.oneOf.map((variant, i) => (
          <SchemaView key={i} schema={variant} base={base} />
        ))}
      </>
    );
  const list = fields(schema);
  if (list)
    return (
      <>
        {schema.type === "array" && <p className="api-note">An array of:</p>}
        <FieldList list={list} base={base} />
      </>
    );
  return (
    <p className="api-note">
      <TypeText parts={typeParts(schema)} base={base} />
    </p>
  );
}

const fill = (path: string, values: Record<string, string> = {}) =>
  path.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);

/** The HTTP text of an example's request and of its answer. */
export function exampleText(document: ApiDocument, example: ApiExample) {
  const op = operation(document, example.operation);
  const head = [
    `${op.method} ${fill(op.path, example.path)}`,
    ...Object.entries(example.headers ?? {}).map(([k, v]) => `${k}: ${v}`),
    ...(example.request !== undefined
      ? ["Content-Type: application/json"]
      : []),
  ];
  const request =
    example.request !== undefined
      ? `${head.join("\n")}\n\n${JSON.stringify(example.request, null, 2)}`
      : head.join("\n");
  const answer =
    example.text !== undefined
      ? `HTTP/1.1 ${example.status}\nContent-Type: text/event-stream\n\n${example.text}`
      : example.response !== undefined
        ? `HTTP/1.1 ${example.status}\nContent-Type: application/json\n\n${JSON.stringify(example.response, null, 2)}`
        : undefined;
  return { op, request, answer };
}

/** An example's request and answer, as Learn shows HTTP, under the operation's name. */
export function Example({
  document,
  example,
}: {
  document: ApiDocument;
  example: ApiExample;
}) {
  const { op, request, answer } = exampleText(document, example);
  return (
    <div className="api-example">
      <div dangerouslySetInnerHTML={{ __html: codeBlock(request, "http") }} />
      {answer && (
        <div dangerouslySetInnerHTML={{ __html: codeBlock(answer, "http") }} />
      )}
      <p className="api-meta">
        <a href={`${REFERENCE}#${op.id}`}>
          <code>{op.id}</code>
        </a>{" "}
        in the reference
      </p>
    </div>
  );
}
