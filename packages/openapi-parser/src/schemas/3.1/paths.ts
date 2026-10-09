import { Schema } from "effect";
import { openApiMap } from "./object.ts";
import { OpenApiPathItem } from "./path-item.ts";

export const OpenApiPaths = openApiMap(
  Schema.String.check(Schema.isPattern(/^\//)),
  OpenApiPathItem,
);

export type OpenApiPaths = typeof OpenApiPaths.Type;
