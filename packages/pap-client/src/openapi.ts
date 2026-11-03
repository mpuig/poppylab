type Schema = {
  type: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  format?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  maxItems?: number;
  minItems?: number;
};
export type ApiTool = {
  description: string;
  schema: Record<string, unknown>;
  execute: (input?: Record<string, unknown>) => Promise<unknown>;
};
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const name = (v: string) =>
  /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(v) &&
  !["constructor", "prototype", "__proto__"].includes(v);
function scalar(v: unknown): Schema {
  if (
    !obj(v) ||
    !["string", "integer", "number", "boolean"].includes(String(v.type)) ||
    Object.keys(v).some(
      (k) =>
        ![
          "type",
          "enum",
          "minimum",
          "maximum",
          "minLength",
          "maxLength",
          "description",
          "format",
        ].includes(k),
    )
  )
    throw Error("Unsupported schema");
  if (
    v.enum !== undefined &&
    (!Array.isArray(v.enum) ||
      v.enum.length > 50 ||
      v.enum.some((x) => !["string", "number", "boolean"].includes(typeof x)))
  )
    throw Error("Unsupported enum");
  for (const k of ["minimum", "maximum", "minLength", "maxLength"])
    if (
      v[k] !== undefined &&
      (typeof v[k] !== "number" || !Number.isFinite(v[k]))
    )
      throw Error("Invalid bound");
  if (
    JSON.stringify(v).length > 4096 ||
    (v.description !== undefined && typeof v.description !== "string")
  )
    throw Error("Schema exceeds bounds");
  if (v.format !== undefined && v.format !== "date")
    throw Error("Unsupported format");
  return {
    ...v,
    ...(typeof v.description === "string"
      ? { description: v.description.slice(0, 300) }
      : {}),
  } as Schema;
}
function structure(v: unknown, depth = 0): Schema {
  if (depth > 4 || !obj(v) || JSON.stringify(v).length > 8000)
    throw Error("Schema exceeds bounds");
  if (v.type !== "object" && v.type !== "array") return scalar(v);
  const allowed =
    v.type === "object"
      ? [
          "type",
          "properties",
          "required",
          "additionalProperties",
          "description",
        ]
      : ["type", "items", "minItems", "maxItems", "description"];
  if (Object.keys(v).some((k) => !allowed.includes(k)))
    throw Error("Unsupported structure");
  const description =
    typeof v.description === "string" ? v.description.slice(0, 300) : undefined;
  if (v.type === "array") {
    for (const key of ["minItems", "maxItems"])
      if (
        v[key] !== undefined &&
        (!Number.isSafeInteger(v[key]) ||
          Number(v[key]) < 0 ||
          Number(v[key]) > 20)
      )
        throw Error("Invalid array bound");
    return {
      type: "array",
      items: structure(v.items, depth + 1),
      maxItems: typeof v.maxItems === "number" ? v.maxItems : 20,
      minItems: typeof v.minItems === "number" ? v.minItems : 0,
      ...(description ? { description } : {}),
    };
  }
  if (
    !obj(v.properties) ||
    Object.keys(v.properties).length > 16 ||
    (v.additionalProperties !== undefined && v.additionalProperties !== false)
  )
    throw Error("Unsupported object");
  const properties: Record<string, Schema> = Object.create(null);
  for (const [key, s] of Object.entries(v.properties)) {
    if (!name(key)) throw Error("Unsafe property");
    properties[key] = structure(s, depth + 1);
  }
  if (
    v.required !== undefined &&
    (!Array.isArray(v.required) ||
      v.required.some(
        (k) => typeof k !== "string" || !Object.hasOwn(properties, k),
      ))
  )
    throw Error("Invalid required");
  return {
    type: "object",
    properties,
    required: (v.required as string[] | undefined) ?? [],
    additionalProperties: false,
    ...(description ? { description } : {}),
  } as Schema;
}
function valid(v: unknown, s: Schema): boolean {
  if (s.type === "array")
    return (
      Array.isArray(v) &&
      v.length <= (s.maxItems ?? 20) &&
      v.length >= (s.minItems ?? 0) &&
      v.every((x) => valid(x, s.items!))
    );
  if (s.type === "object")
    return (
      obj(v) &&
      Object.keys(v).every(
        (k) =>
          Object.hasOwn(s.properties!, k) && valid(v[k], s.properties![k]!),
      ) &&
      (s.required ?? []).every((k) => Object.hasOwn(v, k))
    );
  if (
    s.format === "date" &&
    (typeof v !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
      !Number.isFinite(Date.parse(v)) ||
      new Date(v).toISOString().slice(0, 10) !== v)
  )
    return false;
  if (s.type === "integer" ? !Number.isSafeInteger(v) : typeof v !== s.type)
    return false;
  if (
    typeof v === "number" &&
    (!Number.isFinite(v) ||
      (s.minimum !== undefined && v < s.minimum) ||
      (s.maximum !== undefined && v > s.maximum))
  )
    return false;
  if (
    typeof v === "string" &&
    (v.length > Math.min(s.maxLength ?? 1000, 1000) ||
      v.length < (s.minLength ?? 0))
  )
    return false;
  return !s.enum || s.enum.includes(v);
}
export function boundedToolInput(value: unknown) {
  const schema = structure(value);
  if (schema.type !== "object") throw Error("Tool input must be an object");
  return {
    schema: schema as unknown as Record<string, unknown>,
    validate: (input: unknown) => valid(input, schema),
  };
}
function operationResponse(responses: unknown) {
  if (!obj(responses) || !obj(responses["202"])) return false;
  const content = responses["202"].content;
  if (!obj(content) || !obj(content["application/json"])) return false;
  const schema = content["application/json"].schema;
  return (
    obj(schema) &&
    obj(schema.properties) &&
    obj(schema.properties.operation) &&
    schema.properties.operation.$ref === "#/components/schemas/Operation"
  );
}
/** Bounded OpenAPI subset; proposal POST authority is a local runtime policy, never granted by metadata alone. */
export function openApiTools(
  spec: unknown,
  specUrl: string,
  options: {
    allowProposals: boolean;
    allowOperationResponses?: boolean;
    blockedPaths: string[];
    trace: (s: string) => void;
    request: (
      url: string,
      method: "GET" | "POST",
      body: unknown,
      scopes: string[],
    ) => Promise<unknown>;
  },
): Record<string, ApiTool> {
  if (!obj(spec) || !obj(spec.paths)) throw Error("Invalid OpenAPI");
  const server = Array.isArray(spec.servers) ? spec.servers[0] : undefined;
  const base = new URL(
    obj(server) && typeof server.url === "string"
      ? server.url
      : new URL(specUrl).origin,
  );
  if (
    base.origin !== new URL(specUrl).origin ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw Error("Unsafe OpenAPI server");
  const blocked = (p: string) =>
    /\/(oauth|operations|agent|site)(\/|$)/i.test(p) ||
    options.blockedPaths.some((b) => p === b || p.startsWith(b + "/"));
  if (base.pathname.includes("%")) throw Error("Unsupported encoded base path");
  const tools: Record<string, ApiTool> = Object.create(null) as Record<
      string,
      ApiTool
    >,
    seen = new Set<string>();
  for (const [path, item] of Object.entries(spec.paths).slice(0, 64)) {
    if (!obj(item)) continue;
    for (const method of ["get", "post"] as const) {
      const op = item[method];
      if (
        !obj(op) ||
        typeof op.operationId !== "string" ||
        !name(op.operationId)
      )
        continue;
      const id = op.operationId;
      if (seen.has(id)) {
        delete tools[id];
        continue;
      }
      seen.add(id);
      try {
        if (
          Object.keys(tools).length >= 24 ||
          !path.startsWith("/") ||
          path.startsWith("//") ||
          /[?#\\%]/.test(path) ||
          path.split("/").some((s) => s === "." || s === "..") ||
          /\/(oauth|operations|agent|site)(\/|$)/i.test(path) ||
          options.blockedPaths.some(
            (p) => path === p || path.startsWith(p + "/"),
          )
        )
          throw Error("Restricted endpoint");
        if (
          method === "post" &&
          (!options.allowProposals ||
            (op["x-poppy-proposal"] !== true &&
              !(
                options.allowOperationResponses &&
                operationResponse(op.responses)
              )) ||
            !obj(op.responses) ||
            // Operations v2 refuses with 403 approval_required; v1 used 202.
            !(obj(op.responses["403"]) || obj(op.responses["202"])))
        )
          throw Error("No proposal authority");
        if (
          item.$ref ||
          op.$ref ||
          item.servers ||
          op.servers ||
          (item.parameters !== undefined && !Array.isArray(item.parameters)) ||
          (op.parameters !== undefined && !Array.isArray(op.parameters))
        )
          throw Error("Unsupported overrides");
        const properties: Record<string, Schema> = Object.create(
            null,
          ) as Record<string, Schema>,
          required: string[] = [],
          params: Array<{ name: string; in: string }> = [],
          bodyKeys: string[] = [];
        const parameters = [
          ...(Array.isArray(item.parameters) ? item.parameters : []),
          ...(Array.isArray(op.parameters) ? op.parameters : []),
        ];
        if (parameters.length > 16) throw Error("Too many parameters");
        for (const p of parameters) {
          if (
            !obj(p) ||
            typeof p.name !== "string" ||
            !name(p.name) ||
            !["path", "query"].includes(String(p.in)) ||
            properties[p.name] ||
            p.style ||
            p.explode !== undefined
          )
            throw Error("Unsupported parameter");
          properties[p.name] = scalar(p.schema);
          params.push({ name: p.name, in: String(p.in) });
          if (p.in === "path" || p.required === true) required.push(p.name);
        }
        const slots = [...path.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]);
        if (
          /[{}]/.test(path.replace(/\{[^{}]+\}/g, "")) ||
          slots.some(
            (n) => !params.some((p) => p.in === "path" && p.name === n),
          ) ||
          params.some((p) => p.in === "path" && !slots.includes(p.name))
        )
          throw Error("Unbound path");
        if (op.requestBody !== undefined) {
          if (
            method !== "post" ||
            !obj(op.requestBody) ||
            !obj(op.requestBody.content)
          )
            throw Error("Unsupported body");
          const media = op.requestBody.content["application/json"],
            body = obj(media) ? media.schema : undefined;
          if (
            !obj(body) ||
            body.type !== "object" ||
            !obj(body.properties) ||
            Object.keys(body).some(
              (k) =>
                ![
                  "type",
                  "properties",
                  "required",
                  "additionalProperties",
                  "description",
                ].includes(k),
            ) ||
            (body.additionalProperties !== undefined &&
              body.additionalProperties !== false) ||
            Object.keys(body.properties).length > 16
          )
            throw Error("Unsupported body schema");
          for (const [key, s] of Object.entries(body.properties)) {
            if (!name(key) || properties[key])
              throw Error("Parameter collision");
            properties[key] = structure(s);
            bodyKeys.push(key);
          }
          if (
            body.required !== undefined &&
            (!Array.isArray(body.required) ||
              body.required.some(
                (n) => typeof n !== "string" || !bodyKeys.includes(n),
              ))
          )
            throw Error("Invalid required");
          required.push(...((body.required as string[]) ?? []));
        }
        if (
          blocked(new URL(base.toString().replace(/\/$/, "") + path).pathname)
        )
          throw Error("Control server path excluded");
        if (JSON.stringify(properties).length > 8000)
          throw Error("Tool schema exceeds bounds");
        const scopes =
          op["x-poppy-scopes"] ??
          (typeof op["x-poppy-scope"] === "string"
            ? [op["x-poppy-scope"]]
            : Array.isArray(op.security)
              ? op.security.flatMap((s) =>
                  obj(s) && Array.isArray(s.dpop) ? s.dpop : [],
                )
              : []);
        if (
          !Array.isArray(scopes) ||
          scopes.some((s) => typeof s !== "string") ||
          scopes.length > 16
        )
          throw Error("Invalid scopes");
        tools[id] = {
          description: `${String(op.summary ?? id).slice(0, 400)}${method === "post" ? " Proposal only. User must approve in the playground; never claim execution." : ""}`,
          schema: {
            type: "object",
            properties,
            required,
            additionalProperties: false,
          },
          execute: async (input = {}) => {
            if (
              !obj(input) ||
              JSON.stringify(input).length > 16000 ||
              Object.keys(input).some((k) => !Object.hasOwn(properties, k)) ||
              required.some((k) => !Object.hasOwn(input, k)) ||
              Object.entries(input).some(([k, v]) => !valid(v, properties[k]!))
            )
              throw Error("Invalid tool arguments");
            let route = path;
            for (const p of params.filter((p) => p.in === "path")) {
              const v = String(input[p.name]);
              if (/[/%\\]/.test(v) || v === "." || v === "..")
                throw Error("Unsafe path argument");
              route = route.replaceAll(`{${p.name}}`, encodeURIComponent(v));
            }
            const target = new URL(base.toString().replace(/\/$/, "") + route);
            if (target.origin !== base.origin || blocked(target.pathname))
              throw Error("Unsafe target");
            for (const p of params.filter((p) => p.in === "query"))
              if (Object.hasOwn(input, p.name))
                target.searchParams.set(p.name, String(input[p.name]));
            options.trace(`${method.toUpperCase()} ${route} · Poppy Session`);
            return options.request(
              target.toString(),
              method === "get" ? "GET" : "POST",
              method === "post"
                ? Object.fromEntries(
                    bodyKeys
                      .filter((k) => Object.hasOwn(input, k))
                      .map((k) => [k, input[k]]),
                  )
                : undefined,
              scopes as string[],
            );
          },
        };
      } catch {
        options.trace(
          `Skipped ${id} · unsupported schema or restricted endpoint`,
        );
      }
    }
  }
  return tools;
}
