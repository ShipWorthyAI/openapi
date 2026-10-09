import type { ParsedRequestBody } from "@shipworthy/openapi-transformer";
import { Effect } from "effect";
import ts from "#compiler";
import { TypegenContext } from "../context.ts";
import type { TypegenError } from "../errors.ts";
import {
  addJSDocComment,
  annotationsOf,
  NEVER,
  QUESTION_TOKEN,
  tsModifiers,
  tsPropertyIndex,
} from "../lib/ts.ts";
import { createRef, getEntries } from "../lib/utils.ts";
import { transformMediaType } from "./media-type.ts";

/**
 * Transform a Request Body Object (4.8.13) into `{ content: { [mediaType]: T } }`.
 * @see https://spec.openapis.org/oas/v3.1.0#request-body-object
 */
export const transformRequestBody = Effect.fnUntraced(function* (
  body: ParsedRequestBody,
  path: string,
): Effect.fn.Return<ts.TypeNode, TypegenError, TypegenContext> {
  const ctx = yield* TypegenContext;
  const contents = Object.fromEntries(body.contents.map((media) => [media.mediaType, media]));

  const type = yield* Effect.forEach(
    getEntries(contents, ctx),
    Effect.fnUntraced(function* ([mediaType, media]) {
      const property = ts.factory.createPropertySignature(
        /* modifiers     */ tsModifiers({ readonly: ctx.immutable }),
        /* name          */ tsPropertyIndex(mediaType),
        /* questionToken */ undefined,
        /* type          */ yield* transformMediaType(
          media,
          createRef([path, "content", mediaType]),
        ),
      );

      addJSDocComment(annotationsOf(media), property);
      return property;
    }),
  );

  return ts.factory.createTypeLiteralNode([
    ts.factory.createPropertySignature(
      /* modifiers     */ tsModifiers({ readonly: ctx.immutable }),
      /* name          */ tsPropertyIndex("content"),
      /* questionToken */ undefined,
      /* type          */ ts.factory.createTypeLiteralNode(
        type.length
          ? type
          : // add `"*/*": never` if no media types are defined
            [
              ts.factory.createPropertySignature(
                /* modifiers     */ undefined,
                /* name          */ tsPropertyIndex("*/*"),
                /* questionToken */ QUESTION_TOKEN,
                /* type          */ NEVER,
              ),
            ],
      ),
    ),
  ]);
});
