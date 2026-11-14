import { Record as Rec, Schema } from "effect";
import { OpenApiHeader } from "./header.ts";
import { openApiObject } from "./object.ts";

export const OpenApiParameter = openApiObject({
  ...OpenApiHeader.schema.fields,
  name: Schema.String,
  in: Schema.Literals(["query", "header", "path", "cookie"]),
  style: Schema.optionalKey(
    Schema.Literals([
      "matrix",
      "label",
      "form",
      "simple",
      "spaceDelimited",
      "pipeDelimited",
      "deepObject",
    ]),
  ),
  allowEmptyValue: Schema.optionalKey(Schema.Boolean),
  allowReserved: Schema.optionalKey(Schema.Boolean),
}).check(
  Schema.makeFilter((value) => {
    if (value.in === "path" && value.required !== true) {
      return "Path parameters must set required to true";
    }

    if ((value.schema === undefined) === (value.content === undefined)) {
      return "A parameter must have exactly one of schema or content";
    }

    if (value.content !== undefined && Rec.size(value.content) !== 1) {
      return "Parameter content must contain exactly one media type";
    }

    if (Rec.has(value, "example") && value.examples !== undefined) {
      return "Parameter example and examples are mutually exclusive";
    }

    return undefined;
  }),
);

export type OpenApiParameter = typeof OpenApiParameter.Type;
