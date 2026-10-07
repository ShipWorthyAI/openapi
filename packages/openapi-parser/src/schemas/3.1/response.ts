import { Schema } from "effect";
import { OpenApiHeader } from "./header.js";
import { OpenApiLink } from "./link.js";
import { OpenApiMediaType } from "./media-type.js";
import { openApiObject } from "./object.js";
import { withReference } from "./reference.js";

export const OpenApiResponse = openApiObject({
  description: Schema.String,
  headers: Schema.optionalKey(Schema.Record(Schema.String, withReference(OpenApiHeader))),
  content: Schema.optionalKey(Schema.Record(Schema.String, OpenApiMediaType)),
  links: Schema.optionalKey(Schema.Record(Schema.String, withReference(OpenApiLink))),
});

export type OpenApiResponse = typeof OpenApiResponse.Type;
