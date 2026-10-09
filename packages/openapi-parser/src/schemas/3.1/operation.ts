import { Schema } from "effect";
import { OpenApiCallback } from "./callback.ts";
import { OpenApiExternalDocs } from "./external-docs.ts";
import { openApiObject } from "./object.ts";
import { OpenApiParameter } from "./parameter.ts";
import { withReference } from "./reference.ts";
import { OpenApiRequestBody } from "./request-body.ts";
import { OpenApiResponses } from "./responses.ts";
import { OpenApiSecurityRequirement } from "./security-requirement.ts";
import { OpenApiServer } from "./server.ts";

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
