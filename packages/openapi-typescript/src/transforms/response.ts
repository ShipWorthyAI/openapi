import type { ParsedResponse } from "@shipworthy/openapi-transformer";
import { Effect, Record } from "effect";
import ts from "#compiler";
import type { TypegenContext } from "../context.ts";
import type { TypegenError } from "../errors.ts";
import {
  addJSDocComment,
  annotationsOf,
  NEVER,
  QUESTION_TOKEN,
  refType,
  STRING,
  tsPropertyIndex,
  UNKNOWN,
} from "../lib/ts.ts";
import { createRef } from "../lib/utils.ts";
import { transformHeader } from "./header.ts";
import { transformMediaType } from "./media-type.ts";

/**
 * Transform a Response Object (4.8.17) into `{ headers; content }`.
 * @see https://spec.openapis.org/oas/v3.1.0#response-object
 */
export const transformResponse = Effect.fnUntraced(function* (
  response: ParsedResponse,
  path: string,
): Effect.fn.Return<ts.TypeNode, TypegenError, TypegenContext> {
  const declared = Object.fromEntries(response.headers.map((header) => [header.name, header]));

  const headers: ts.TypeElement[] = yield* Effect.forEach(
    Record.toEntries(declared),
    Effect.fnUntraced(function* ([name, header]) {
      const property = ts.factory.createPropertySignature(
        /* modifiers     */ undefined,
        /* name          */ tsPropertyIndex(name),
        // a referenced header has always printed as required
        /* questionToken */ header.reference || header.required ? undefined : QUESTION_TOKEN,
        /* type          */ header.reference
          ? yield* refType(header.reference.$ref)
          : yield* transformHeader(header, createRef([path, "headers", name])),
      );

      addJSDocComment(annotationsOf(header), property);
      return property;
    }),
  );

  // allow additional unknown headers
  headers.push(
    ts.factory.createIndexSignature(
      /* modifiers     */ undefined,
      /* parameters */ [
        ts.factory.createParameterDeclaration(
          /* modifiers      */ undefined,
          /* dotDotDotToken */ undefined,
          /* name           */ ts.factory.createIdentifier("name"),
          /* questionToken  */ undefined,
          /* type           */ STRING,
        ),
      ],
      /* type          */ UNKNOWN,
    ),
  );

  const contents = Object.fromEntries(response.contents.map((media) => [media.mediaType, media]));

  const content = yield* Effect.forEach(
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
      /* name          */ tsPropertyIndex("headers"),
      /* questionToken */ undefined,
      /* type          */ ts.factory.createTypeLiteralNode(headers),
    ),
    ts.factory.createPropertySignature(
      /* modifiers     */ undefined,
      /* name          */ tsPropertyIndex("content"),
      /* questionToken */ content.length ? undefined : QUESTION_TOKEN,
      /* type          */ content.length ? ts.factory.createTypeLiteralNode(content) : NEVER,
    ),
  ]);
});
