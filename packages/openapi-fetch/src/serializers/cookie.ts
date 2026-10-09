import { serializePrimitiveParam } from "./param.js";

type Primitive = string | number | boolean;

/**
 * Serialize cookie params to a `Cookie` header value using the OpenAPI default
 * (style: form, explode: true). Arrays repeat the name, objects emit one pair per key,
 * and values are URI-encoded. `undefined` and `null` values are skipped.
 * @see https://swagger.io/docs/specification/serialization/#cookie
 */
export function serializeCookieParams(cookieParams: Record<string, unknown> | undefined): string {
  const pairs: string[] = [];

  if (!cookieParams || typeof cookieParams !== "object") {
    return "";
  }

  const push = (name: string, value: unknown) => {
    if (value === undefined || value === null) {
      return;
    }

    pairs.push(serializePrimitiveParam(name, value as Primitive));
  };

  for (const name in cookieParams) {
    const value = cookieParams[name];

    if (Array.isArray(value)) {
      for (const v of value) {
        push(name, v);
      }
    } else if (value !== null && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        push(k, v);
      }
    } else {
      push(name, value);
    }
  }

  return pairs.join("; ");
}
