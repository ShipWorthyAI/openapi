import type { ParsedHeader } from "@shipworthy/openapi-transformer";
import { Effect, Record } from "effect";
import ts from "#compiler";
import type { TypegenContext } from "../context.ts";
import type { TypegenError } from "../errors.ts";
import { addJSDocComment, annotationsOf, tsPropertyIndex, UNKNOWN } from "../lib/ts.ts";
import { createRef } from "../lib/utils.ts";
import { transformMediaType } from "./media-type.ts";
import { transformSchema } from "./schema.ts";

/**
 * Transform a Header Object (4.8.21) into the type of its value.
 * @see https://spec.openapis.org/oas/v3.1.0#header-object
 */
export const transformHeader = Effect.fnUntraced(function* (
  header: ParsedHeader,
  path: string,
): Effect.fn.Return<ts.TypeNode, TypegenError, TypegenContext> {
  if (header.schema !== undefined) {
    return yield* transformSchema(header.schema, path);
  }

  if (header.contents.length === 0) {
    return UNKNOWN;
  }

  const contents = Record.fromIterableBy(header.contents, (media) => media.mediaType);

  const type = yield* Effect.forEach(
    Record.toEntries(contents),
    Effect.fnUntraced(function* ([mediaType, media]) {
      const property = ts.factory.createPropertySignature(
        /* modifiers     */ undefined,
        /* name          */ tsPropertyIndex(mediaType),
        /* questionToken */ undefined,
        /* type          */ yield* transformMediaType(media, createRef([path, mediaType])),
      );

      addJSDocComment(annotationsOf(media), property);
      return property;
    }),
  );

  return ts.factory.createTypeLiteralNode(type);
});
