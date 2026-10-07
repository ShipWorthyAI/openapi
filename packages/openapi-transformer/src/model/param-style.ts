import { Schema } from "effect";

/** How a parameter, header, or encoded property serializes its value. */
export const ParamStyle = Schema.Literals([
  "simple",
  "matrix",
  "label",
  "form",
  "spaceDelimited",
  "pipeDelimited",
  "deepObject",
]);

export type ParamStyle = typeof ParamStyle.Type;
