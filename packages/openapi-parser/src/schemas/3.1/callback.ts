import { Schema } from "effect";
import { openApiMap } from "./object.js";
import { OpenApiPathItem } from "./path-item.js";

export const OpenApiCallback = openApiMap(
  Schema.String.check(Schema.makeFilter((key) => !key.startsWith("x-"))),
  Schema.suspend((): Schema.Codec<OpenApiPathItem> => OpenApiPathItem),
);

export type OpenApiCallback = typeof OpenApiCallback.Type;
