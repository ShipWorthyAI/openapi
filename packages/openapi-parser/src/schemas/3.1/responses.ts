import { Schema } from "effect";
import { openApiMap } from "./object.ts";
import { withReference } from "./reference.ts";
import { OpenApiResponse } from "./response.ts";

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
