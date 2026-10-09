import type { PathSerializer, QuerySerializer } from "../types.ts";

/** Construct URL string from baseUrl and handle path and query params */
export function createFinalURL<O>(
  pathname: string,
  options: {
    baseUrl: string;
    params: {
      query?: Record<string, unknown>;
      path?: Record<string, unknown>;
    };
    querySerializer: QuerySerializer<O>;
    pathSerializer: PathSerializer;
  },
): string {
  let finalURL = `${options.baseUrl}${pathname}`;

  if (options.params?.path) {
    finalURL = options.pathSerializer(finalURL, options.params.path);
  }

  let search = (options.querySerializer as (query: Record<string, unknown>) => string)(
    options.params.query ?? {},
  );

  if (search.startsWith("?")) {
    search = search.substring(1);
  }

  if (search) {
    finalURL += `?${search}`;
  }

  return finalURL;
}

/** Remove trailing slash from url */
export function removeTrailingSlash(url: string): string {
  if (url.endsWith("/")) {
    return url.substring(0, url.length - 1);
  }

  return url;
}
