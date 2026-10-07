import { Schema } from "effect";

/** Path item keys that hold operations, in the order operations are listed. */
export const httpMethods = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const;

export const HttpMethodName = Schema.Literals([
  "GET",
  "PUT",
  "POST",
  "DELETE",
  "OPTIONS",
  "HEAD",
  "PATCH",
  "TRACE",
]);

export type HttpMethodName = typeof HttpMethodName.Type;
