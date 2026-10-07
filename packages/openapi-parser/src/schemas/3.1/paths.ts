import { Schema } from "effect";
import { openApiMap } from "./object.js";
import { OpenApiPathItem } from "./path-item.js";

export const OpenApiPaths = openApiMap(
  Schema.String.check(Schema.isPattern(/^\//)),
  OpenApiPathItem,
);

export type OpenApiPaths = typeof OpenApiPaths.Type;
