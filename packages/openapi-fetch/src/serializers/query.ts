import type { QuerySerializerOptions } from "../types.js";
import { serializeArrayParam, serializeObjectParam, serializePrimitiveParam } from "./param.js";

/** Serialize query params to string */
export function createQuerySerializer<T = unknown>(
  options?: QuerySerializerOptions,
): (queryParams: T) => string {
  return function querySerializer(queryParams) {
    const search = [];

    if (queryParams && typeof queryParams === "object") {
      for (const name in queryParams) {
        const value = (queryParams as Record<string, unknown>)[name];

        if (value === undefined || value === null) {
          continue;
        }

        if (Array.isArray(value)) {
          if (value.length === 0) {
            continue;
          }

          search.push(
            serializeArrayParam(name, value, {
              style: "form",
              explode: true,
              ...options?.array,
              allowReserved: options?.allowReserved || false,
            }),
          );

          continue;
        }

        if (typeof value === "object") {
          search.push(
            serializeObjectParam(name, value as Record<string, unknown>, {
              style: "deepObject",
              explode: true,
              ...options?.object,
              allowReserved: options?.allowReserved || false,
            }),
          );

          continue;
        }

        search.push(serializePrimitiveParam(name, value as string | number | boolean, options));
      }
    }

    return search.join("&");
  };
}
