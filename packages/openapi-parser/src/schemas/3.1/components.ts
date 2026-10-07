import { Schema } from "effect";
import { OpenApiCallback } from "./callback.js";
import { OpenApiExample } from "./example.js";
import { OpenApiHeader } from "./header.js";
import { OpenApiLink } from "./link.js";
import { openApiObject } from "./object.js";
import { OpenApiParameter } from "./parameter.js";
import { OpenApiPathItem } from "./path-item.js";
import { withReference } from "./reference.js";
import { OpenApiRequestBody } from "./request-body.js";
import { OpenApiResponse } from "./response.js";
import { OpenApiSchema } from "./schema.js";
import { OpenApiSecurityScheme } from "./security-scheme.js";

export const OpenApiComponents = openApiObject({
  schemas: Schema.optionalKey(Schema.Record(Schema.String, OpenApiSchema)),
  responses: Schema.optionalKey(Schema.Record(Schema.String, withReference(OpenApiResponse))),
  parameters: Schema.optionalKey(Schema.Record(Schema.String, withReference(OpenApiParameter))),
  examples: Schema.optionalKey(Schema.Record(Schema.String, withReference(OpenApiExample))),
  requestBodies: Schema.optionalKey(
    Schema.Record(Schema.String, withReference(OpenApiRequestBody)),
  ),
  headers: Schema.optionalKey(Schema.Record(Schema.String, withReference(OpenApiHeader))),
  securitySchemes: Schema.optionalKey(
    Schema.Record(Schema.String, withReference(OpenApiSecurityScheme)),
  ),
  links: Schema.optionalKey(Schema.Record(Schema.String, withReference(OpenApiLink))),
  callbacks: Schema.optionalKey(Schema.Record(Schema.String, withReference(OpenApiCallback))),
  pathItems: Schema.optionalKey(Schema.Record(Schema.String, OpenApiPathItem)),
});

export type OpenApiComponents = typeof OpenApiComponents.Type;
