import { Schema } from "effect";
import { OpenApiHttpMethod } from "@shipworthy/openapi-parser/schemas/3.1";

/** Path item keys that hold operations, in the order operations are listed. */
export const httpMethods = OpenApiHttpMethod.literals;

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
