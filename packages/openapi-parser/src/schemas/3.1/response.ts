import { Schema } from "effect";
import { OpenApiHeader } from "./header.ts";
import { OpenApiLink } from "./link.ts";
import { OpenApiMediaType } from "./media-type.ts";
import { openApiObject } from "./object.ts";
import { withReference } from "./reference.ts";

export const OpenApiResponse = openApiObject({
  description: Schema.String,
  headers: Schema.optionalKey(Schema.Record(Schema.String, withReference(OpenApiHeader))),
  content: Schema.optionalKey(Schema.Record(Schema.String, OpenApiMediaType)),
  links: Schema.optionalKey(Schema.Record(Schema.String, withReference(OpenApiLink))),
});

export type OpenApiResponse = typeof OpenApiResponse.Type;
