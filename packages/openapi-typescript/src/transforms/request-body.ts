import type { ParsedRequestBody } from "@shipworthy/openapi-transformer";
import { Effect, Record } from "effect";
import ts from "#compiler";
import type { TypegenContext } from "../context.ts";
import type { TypegenError } from "../errors.ts";
import {
  addJSDocComment,
  annotationsOf,
  NEVER,
  QUESTION_TOKEN,
  tsPropertyIndex,
} from "../lib/ts.ts";
import { createRef } from "../lib/utils.ts";
import { transformMediaType } from "./media-type.ts";

/**
 * Transform a Request Body Object (4.8.13) into `{ content: { [mediaType]: T } }`.
 * @see https://spec.openapis.org/oas/v3.1.0#request-body-object
 */
export const transformRequestBody = Effect.fnUntraced(function* (
  body: ParsedRequestBody,
  path: string,
): Effect.fn.Return<ts.TypeNode, TypegenError, TypegenContext> {
  const contents = Record.fromIterableBy(body.contents, (media) => media.mediaType);

  const type = yield* Effect.forEach(
    Record.toEntries(contents),
    Effect.fnUntraced(function* ([mediaType, media]) {
      const property = ts.factory.createPropertySignature(
        /* modifiers     */ undefined,
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
      /* modifiers     */ undefined,
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
