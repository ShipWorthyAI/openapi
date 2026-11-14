import { OpenApiReference, type ParsedOpenApi } from "@shipworthy/openapi-parser/schemas/3.1";
import {
  Array,
  Effect,
  JsonPointer,
  pipe,
  Predicate,
  Record,
  Schema,
  SchemaIssue,
  String,
} from "effect";
import type { ParsedRef } from "../../model/index.ts";

const isReference = Schema.is(OpenApiReference);

/** parseUriFragment rejects unencoded spaces. OpenAPI path refs may contain them. */
function tokens(ref: string): readonly string[] | undefined {
  const parsed = JsonPointer.parseUriFragment(ref);
  if (parsed) return parsed;
  if (ref === "#") return [];
  if (!String.startsWith("#/")(ref)) return undefined;

  return pipe(
    ref,
    String.slice(2),
    String.split("/"),
    Array.map((token) => JsonPointer.unescapeToken(token)),
  );
}

function pointer(document: ParsedOpenApi, ref: string): unknown {
  const path = tokens(ref);
  if (!path) return undefined;
  let node: unknown = document;

  for (const key of path) {
    if (Array.isArray(node)) node = node[Number(key)];
    else if (Predicate.isObject(node) && Record.has(node, key)) node = node[key];
    else return undefined;
  }

  return node;
}

/** Append JSON Pointer segments to a pointer. */
export function child(at: string, ...segments: readonly (string | number)[]): string {
  return Array.reduce(
    segments,
    at,
    (path, segment) => `${path}/${JsonPointer.escapeToken(`${segment}`)}`,
  );
}

/** Follow references and check their target against the expected specification object. */
export const resolve = Effect.fnUntraced(function* <A>(
  document: ParsedOpenApi,
  schema: Schema.Codec<A>,
  value: NoInfer<A> | OpenApiReference,
  at: string,
  mergeSiblings = false,
) {
  if (!isReference(value)) return { value, id: at, reference: undefined };

  const reference = {
    $ref: value.$ref,
    summary: value.summary,
    description: value.description,
  } satisfies typeof ParsedRef.Encoded;

  const seen = new Set<string>();
  let node: unknown = value;
  let id = at;
  let siblings: Record<string, unknown> = {};

  while (isReference(node)) {
    const ref = node.$ref;
    const path = tokens(ref);

    if (path === undefined || seen.has(ref)) {
      return yield* Effect.fail(
        new SchemaIssue.Pointer(
          tokens(at) ?? [],
          new SchemaIssue.InvalidValue({
            message:
              path === undefined
                ? `Expected a local reference: ${ref}`
                : `Circular reference: ${ref}`,
          }),
        ),
      );
    }

    if (mergeSiblings) {
      const { $ref: _ref, ...rest } = node;
      siblings = { ...rest, ...siblings };
    }

    seen.add(ref);
    id = ref;
    node = pointer(document, ref);

    if (node === undefined) {
      return yield* Effect.fail(
        new SchemaIssue.Pointer(
          tokens(at) ?? [],
          new SchemaIssue.InvalidValue({
            message: `Unresolved reference: ${ref}`,
          }),
        ),
      );
    }
  }

  const target = mergeSiblings && Predicate.isObject(node) ? { ...node, ...siblings } : node;

  const resolved = yield* Schema.decodeUnknownEffect(schema)(target).pipe(
    Effect.mapError((error) => new SchemaIssue.Pointer(tokens(id) ?? [], error.issue)),
  );

  return mergeSiblings
    ? { value: resolved, id: at, reference: undefined }
    : { value: resolved, id, reference };
});
