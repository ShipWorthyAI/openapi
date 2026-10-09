import { Schema } from "effect";
import { OpenApiHeader } from "./header.ts";
import { openApiObject } from "./object.ts";
import { withReference } from "./reference.ts";

export const OpenApiEncoding = openApiObject({
  contentType: Schema.optionalKey(Schema.String),
  headers: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      withReference(Schema.suspend((): Schema.Codec<OpenApiHeader> => OpenApiHeader)),
    ),
  ),
  style: Schema.optionalKey(
    Schema.Literals(["form", "spaceDelimited", "pipeDelimited", "deepObject"]),
  ),
  explode: Schema.optionalKey(Schema.Boolean),
  allowReserved: Schema.optionalKey(Schema.Boolean),
});

export type OpenApiEncoding = typeof OpenApiEncoding.Type;
