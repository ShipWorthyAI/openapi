import type { HeadersOptions } from "./types.js";

/** Merge headers a and b, with b taking priority */
export function mergeHeaders(...allHeaders: (HeadersOptions | undefined)[]): Headers {
  const finalHeaders = new Headers();
  for (const h of allHeaders) {
    if (!h || typeof h !== "object") {
      continue;
    }
    const iterator = h instanceof Headers ? h.entries() : Object.entries(h);
    for (const [k, v] of iterator) {
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
