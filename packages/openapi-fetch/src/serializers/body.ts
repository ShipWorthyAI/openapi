/** Serialize body object to string */
export function defaultBodySerializer<T>(
  body: T,
  headers?: Headers | Record<string, unknown>,
): string | FormData {
  if (body instanceof FormData) {
    return body;
  }

  if (headers) {
    const contentType =
      typeof (headers as Headers).get === "function"
        ? ((headers as Headers).get("Content-Type") ?? (headers as Headers).get("content-type"))
        : ((headers as Record<string, unknown>)["Content-Type"] ??
          (headers as Record<string, unknown>)["content-type"]);

    if (contentType === "application/x-www-form-urlencoded") {
      return new URLSearchParams(body as Record<string, string>).toString();
    }
  }

  return JSON.stringify(body);
}
