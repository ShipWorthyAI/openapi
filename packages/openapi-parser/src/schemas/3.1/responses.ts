import { Schema } from "effect";
import { openApiMap } from "./object.js";
import { withReference } from "./reference.js";
import { OpenApiResponse } from "./response.js";

export const OpenApiResponses = openApiMap(
  Schema.String.check(Schema.isPattern(/^(?:default|[1-5](?:\d{2}|XX))$/)),
  withReference(OpenApiResponse),
).check(
  Schema.makeFilter((value) =>
    Object.keys(value).some((key) => !key.startsWith("x-"))
      ? undefined
      : "Responses must contain at least one response",
  ),
);

export type OpenApiResponses = typeof OpenApiResponses.Type;
