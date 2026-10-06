import type { LookupFunction } from "node:net";
import type { Agent } from "undici";
import { Effect } from "effect";
import { ResolverFailure } from "./errors.js";
import type { EffectPlugin, HttpResolverOptions, Options } from "./plugins.js";
import { httpOrigin, isAllowedOrigin, isHttp, isUnsafeUrl, resolveUrlSafety, type ResolvedUrlAddress } from "./url.js";

interface UndiciModule {
  Agent: new (options?: { connect?: { lookup: LookupFunction }; autoSelectFamily?: boolean }) => Agent;
  fetch(input: URL | string, init?: object): Promise<unknown>;
}

export function httpResolver(rootUrl: string, options: Options): EffectPlugin<Uint8Array> | undefined {
  if (options.resolve?.http === false) return undefined;
  const http = httpSettings(rootUrl, options);
  return {
    order: 200,
    can: (file) =>
      isHttp(file.url) &&
      (http.safeUrlResolver === false || isAllowedOrigin(file.url, http.allowedOrigins) || !isUnsafeUrl(file.url)),
    run: (file) => download(file.url, http),
  };
}

function httpSettings(rootUrl: string, options: Options): HttpResolverOptions {
  const user = typeof options.resolve?.http === "object" ? options.resolve.http : {};
  const origin = httpOrigin(rootUrl);
  const allowed = [...(user.allowedOrigins ?? [])];
  if (origin && !allowed.includes(origin)) allowed.push(origin);
  return {
    headers: null,
    timeout: 60_000,
    redirects: 5,
    withCredentials: false,
    safeUrlResolver: true,
    ...user,
    allowedOrigins: allowed,
  };
}

const download: (
  href: string,
  http: HttpResolverOptions,
  redirects?: string[],
) => Effect.Effect<Uint8Array, ResolverFailure> = Effect.fnUntraced(function* (href, http, redirects: string[] = []) {
  const nextRedirects = [...redirects, href];
  const requestedPrivate = isAllowedOrigin(href, http.allowedOrigins) && isUnsafeUrl(href);
  let addresses: readonly ResolvedUrlAddress[] | undefined;
  if (http.safeUrlResolver !== false && !requestedPrivate) {
    const safety = yield* resolveUrlSafety(href);
    if (safety.unsafe) {
      return yield* Effect.fail(
        new ResolverFailure({
          message: `Error downloading ${href}: Unsafe URL blocked by safeUrlResolver: ${href}`,
          source: href,
          ioErrorCode: "",
        }),
      );
    }
    addresses = safety.addresses;
  }

  const pending = yield* Effect.tryPromise({
    try: () => get(href, http, addresses),
    catch: (cause) => resolverFailure(href, cause),
  });

  try {
    const response = pending.response;
    if (response.status >= 400) {
      return yield* Effect.fail(
        new ResolverFailure({
          message: `Error downloading ${href}: HTTP ERROR ${response.status}`,
          source: href,
          ioErrorCode: String(response.status),
        }),
      );
    }
    if (response.status >= 300) {
      if (http.redirects !== undefined && nextRedirects.length > http.redirects) {
        return yield* Effect.fail(
          new ResolverFailure({
            message: `Error downloading ${nextRedirects[0]}. \nToo many redirects: \n  ${nextRedirects.join(" \n  ")}`,
            source: href,
            ioErrorCode: String(response.status),
          }),
        );
      }
      const location = response.headers.get("location");
      if (!location) {
        return yield* Effect.fail(
          new ResolverFailure({
            message: `Error downloading ${href}: HTTP ${response.status} redirect with no location header`,
            source: href,
            ioErrorCode: String(response.status),
          }),
        );
      }
      const redirectTo = new URL(location, href).href;
      const redirectOptions = new URL(redirectTo).origin === new URL(href).origin ? http : withoutSensitiveHeaders(http);
      return yield* download(redirectTo, redirectOptions, nextRedirects);
    }
    if (!response.body) return new Uint8Array();
    const bytes = yield* Effect.tryPromise({
      try: async () => new Uint8Array(await response.arrayBuffer()),
      catch: (cause) => resolverFailure(href, cause),
    });
    return bytes;
  } finally {
    pending.cancelTimeout();
  }
});

function resolverFailure(href: string, cause: unknown): ResolverFailure {
  const message = cause instanceof Error ? cause.message : String(cause);
  const code = typeof cause === "object" && cause !== null && "code" in cause && cause.code != null ? String(cause.code) : "";
  return new ResolverFailure({
    message: message.startsWith("Error downloading") ? message : `Error downloading ${href}: ${message}`,
    source: href,
    ioErrorCode: code,
  });
}

interface PendingResponse {
  response: Response;
  cancelTimeout: () => void;
}

async function get(
  href: string,
  http: HttpResolverOptions,
  addresses: readonly ResolvedUrlAddress[] | undefined,
): Promise<PendingResponse> {
  const pinned = addresses && addresses.length > 0 ? await createPinnedTransport(new URL(href), addresses) : undefined;
  const dispatcher = pinned?.dispatcher;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const controller = http.timeout ? new AbortController() : undefined;
  if (controller && http.timeout) timeoutId = setTimeout(() => controller.abort(), http.timeout);
  const cancelTimeout = () => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (dispatcher && !dispatcher.destroyed) void dispatcher.destroy().catch(() => undefined);
  };
  try {
    const request: RequestInit = {
      method: "GET",
      headers: http.headers || {},
      credentials: http.withCredentials ? "include" : "same-origin",
      redirect: "manual",
      signal: controller ? controller.signal : null,
    };
    const response = pinned
      ? ((await pinned.fetch(href, dispatcher ? { ...request, dispatcher } : request)) as Response)
      : await fetch(href, request);
    return { response, cancelTimeout };
  } catch (error) {
    cancelTimeout();
    throw error;
  }
}

async function createPinnedTransport(requestUrl: URL, resolvedAddresses: readonly ResolvedUrlAddress[]) {
  const undici = (await import("undici")) as UndiciModule;
  const expectedHostname = normalizeLookupHostname(requestUrl.hostname);
  const pinnedAddresses = resolvedAddresses.map(({ address, family }) => ({ address, family }));
  const lookup: LookupFunction = (hostname, options, callback) => {
    const normalizedHostname = normalizeLookupHostname(hostname);
    const requestedFamily = options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : options.family || 0;
    const candidates = pinnedAddresses.filter(({ family }) => requestedFamily === 0 || family === requestedFamily);
    if (normalizedHostname !== expectedHostname || candidates.length === 0) {
      const error = new Error(`No validated address is available for ${hostname}`) as NodeJS.ErrnoException;
      error.code = "ENOTFOUND";
      callback(error, "", 0);
    } else if (options.all) {
      callback(null, candidates);
    } else {
      const selected = candidates[0]!;
      callback(null, selected.address, selected.family);
    }
  };
  return {
    dispatcher: new undici.Agent({ connect: { lookup }, autoSelectFamily: true }),
    fetch: (input: URL | string, init?: object) => undici.fetch(input, init),
  };
}

function normalizeLookupHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "").toLowerCase();
}

function withoutSensitiveHeaders(http: HttpResolverOptions): HttpResolverOptions {
  if (!http.headers) return http;
  const headers = new Headers(http.headers);
  headers.delete("authorization");
  headers.delete("proxy-authorization");
  headers.delete("cookie");
  return { ...http, headers: Object.fromEntries(headers.entries()) };
}
