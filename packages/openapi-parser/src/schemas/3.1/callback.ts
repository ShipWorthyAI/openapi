import { Schema, String as Str } from "effect";
import { openApiMap } from "./object.ts";
import { OpenApiPathItem } from "./path-item.ts";

export const OpenApiCallback = openApiMap(
  Schema.String.check(Schema.makeFilter((key) => !Str.startsWith("x-")(key))),
  Schema.suspend((): Schema.Codec<OpenApiPathItem> => OpenApiPathItem),
);

export type OpenApiCallback = typeof OpenApiCallback.Type;
