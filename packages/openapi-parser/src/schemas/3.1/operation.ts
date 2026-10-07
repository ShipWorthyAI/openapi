import { Schema } from "effect";
import { OpenApiCallback } from "./callback.js";
import { OpenApiExternalDocs } from "./external-docs.js";
import { openApiObject } from "./object.js";
import { OpenApiParameter } from "./parameter.js";
import { withReference } from "./reference.js";
import { OpenApiRequestBody } from "./request-body.js";
import { OpenApiResponses } from "./responses.js";
import { OpenApiSecurityRequirement } from "./security-requirement.js";
import { OpenApiServer } from "./server.js";

const fields = {
  tags: Schema.optionalKey(Schema.Array(Schema.String)),
  summary: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  externalDocs: Schema.optionalKey(OpenApiExternalDocs),
  operationId: Schema.optionalKey(Schema.String),
  parameters: Schema.optionalKey(Schema.Array(withReference(OpenApiParameter))),
  requestBody: Schema.optionalKey(withReference(OpenApiRequestBody)),
  responses: Schema.optionalKey(OpenApiResponses),
  callbacks: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      withReference(Schema.suspend((): Schema.Codec<OpenApiCallback> => OpenApiCallback)),
    ),
  ),
  deprecated: Schema.optionalKey(Schema.Boolean),
  security: Schema.optionalKey(Schema.Array(OpenApiSecurityRequirement)),
  servers: Schema.optionalKey(Schema.Array(OpenApiServer)),
};

/** Callback recursion is tied through an interface whose fields all come from the schema. */
export interface OpenApiOperation extends Schema.Struct.Type<typeof fields> {
  readonly [key: string]: unknown;
}

export const OpenApiOperation = openApiObject(fields);
