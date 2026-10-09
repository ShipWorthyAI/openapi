import type { HeadersOptions } from "./types.js";

type HeaderValue = string | number | boolean | (string | number | boolean)[] | null | undefined;

/** Iterate any `HeadersOptions` form (plain object, `Headers`, or `[name, value]` tuples) as entries */
function headerEntries(h: HeadersOptions): Iterable<[string, HeaderValue]> {
  if (h instanceof Headers) {
    return h.entries();
  }

  if (Array.isArray(h)) {
    // Normalize tuple arrays through `Headers` so repeated names combine like any other `HeadersInit`
    return new Headers(h).entries();
  }

  return Object.entries(h);
}

/** Merge headers a and b, with b taking priority */
export function mergeHeaders(...allHeaders: (HeadersOptions | undefined)[]): Headers {
  const finalHeaders = new Headers();

  for (const h of allHeaders) {
    if (!h || typeof h !== "object") {
      continue;
    }

    for (const [k, v] of headerEntries(h)) {
      if (v === null) {
        finalHeaders.delete(k);
      } else if (Array.isArray(v)) {
        for (const v2 of v) {
          finalHeaders.append(k, String(v2));
        }
      } else if (v !== undefined) {
        finalHeaders.set(k, String(v));
      }
    }
  }

  return finalHeaders;
}
