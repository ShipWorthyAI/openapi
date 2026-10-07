import { Schema } from "effect";
import { openApiObject } from "./object.js";

export const OpenApiLicense = openApiObject({
  name: Schema.String,
  identifier: Schema.optionalKey(Schema.String),
  url: Schema.optionalKey(Schema.String),
}).check(
  Schema.makeFilter((value) =>
    value.identifier !== undefined && value.url !== undefined
      ? "License identifier and url are mutually exclusive"
      : undefined,
  ),
);

export type OpenApiLicense = typeof OpenApiLicense.Type;
