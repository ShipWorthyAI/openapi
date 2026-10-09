import type { ParsedHeader } from "@shipworthy/openapi-transformer";
import { Effect } from "effect";
import ts from "#compiler";
import { TypegenContext } from "../context.ts";
import type { TypegenError } from "../errors.ts";
import {
  addJSDocComment,
  annotationsOf,
  tsModifiers,
  tsPropertyIndex,
  UNKNOWN,
} from "../lib/ts.ts";
import { createRef, getEntries } from "../lib/utils.ts";
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
  const ctx = yield* TypegenContext;

  if (header.schema !== undefined) {
    return yield* transformSchema(header.schema, path);
  }

  if (header.contents.length === 0) {
    return UNKNOWN;
  }

  const type: ts.TypeElement[] = [];
  const contents = Object.fromEntries(header.contents.map((media) => [media.mediaType, media]));

  for (const [mediaType, media] of getEntries(contents, ctx)) {
    const property = ts.factory.createPropertySignature(
      /* modifiers     */ tsModifiers({ readonly: ctx.immutable }),
      /* name          */ tsPropertyIndex(mediaType),
      /* questionToken */ undefined,
      /* type          */ yield* transformMediaType(media, createRef([path, mediaType])),
    );

    addJSDocComment(annotationsOf(media), property);
    type.push(property);
  }

  return ts.factory.createTypeLiteralNode(type);
});
