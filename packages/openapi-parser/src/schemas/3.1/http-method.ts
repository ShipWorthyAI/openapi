import { Schema } from "effect";

/** Path item keys that hold operations, in traversal order. */
export const OpenApiHttpMethod = Schema.Literals([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);

export type OpenApiHttpMethod = typeof OpenApiHttpMethod.Type;
