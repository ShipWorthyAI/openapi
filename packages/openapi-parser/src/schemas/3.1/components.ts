import { Schema } from "effect";
import { OpenApiCallback } from "./callback.ts";
import { OpenApiExample } from "./example.ts";
import { OpenApiHeader } from "./header.ts";
import { OpenApiLink } from "./link.ts";
import { openApiObject } from "./object.ts";
import { OpenApiParameter } from "./parameter.ts";
import { OpenApiPathItem } from "./path-item.ts";
import { withReference } from "./reference.ts";
import { OpenApiRequestBody } from "./request-body.ts";
import { OpenApiResponse } from "./response.ts";
import { OpenApiSchema } from "./schema.ts";
import { OpenApiSecurityScheme } from "./security-scheme.ts";

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
