import type { LookupFunction } from "node:net";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { Agent } from "@effect/platform-node/Undici";
import { Cause, Effect, Schedule, type Scope } from "effect";
import { HttpClient } from "effect/http";
import { ResolverFailure, nodeErrorCode, timeoutFailure, type TimeoutFailure } from "./errors.js";
import type { EffectPlugin, HttpResolverOptions, Options } from "./plugins.js";
import {
  httpOrigin,
  isAllowedOrigin,
  isHttp,
  isUnsafeUrl,
  resolveUrlSafety,
  type ResolvedUrlAddress,
} from "./url.js";

type Hop =
  | { readonly kind: "body"; readonly bytes: Uint8Array }
  | { readonly kind: "redirect"; readonly href: string; readonly http: HttpResolverOptions };

export function httpResolver(
  rootUrl: string,
  options: Options,
): EffectPlugin<Uint8Array> | undefined {
  if (options.resolve?.http === false) return undefined;
  const http = httpSettings(rootUrl, options);

  return {
    order: 200,
    can: (file) =>
      isHttp(file.url) &&
      (http.safeUrlResolver === false ||
        isAllowedOrigin(file.url, http.allowedOrigins) ||
        !isUnsafeUrl(file.url)),
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

const download = Effect.fnUntraced(function* (
  href: string,
  http: HttpResolverOptions,
  redirects: readonly string[] = [],
): Effect.fn.Return<Uint8Array, ResolverFailure | TimeoutFailure, HttpClient.HttpClient> {
  const nextRedirects = [...redirects, href];
  const requestedPrivate = isAllowedOrigin(href, http.allowedOrigins) && isUnsafeUrl(href);
  let addresses: readonly ResolvedUrlAddress[] | undefined;

  if (http.safeUrlResolver !== false && !requestedPrivate) {
    const safety = yield* resolveUrlSafety(href);

    if (safety.unsafe) {
      return yield* new ResolverFailure({
        message: `Error downloading ${href}: Unsafe URL blocked by safeUrlResolver: ${href}`,
        source: href,
      });
    }

    addresses = safety.addresses;
  }

  const hop =
    addresses && addresses.length > 0
      ? yield* Effect.scoped(pinnedHop(href, http, addresses, nextRedirects))
      : yield* receive(yield* HttpClient.HttpClient, href, http, nextRedirects);

  if (hop.kind === "redirect") return yield* download(hop.href, hop.http, nextRedirects);
  return hop.bytes;
});

const pinnedHop = Effect.fnUntraced(function* (
  href: string,
  http: HttpResolverOptions,
  addresses: readonly ResolvedUrlAddress[],
  redirects: readonly string[],
): Effect.fn.Return<Hop, ResolverFailure | TimeoutFailure, Scope.Scope> {
  const dispatcher = yield* Effect.acquireRelease(
    Effect.sync(
      () =>
        new Agent({
          connect: { lookup: pinnedLookup(href, addresses) },
          autoSelectFamily: true,
        }),
    ),
    (agent) => Effect.promise(() => agent.destroy()),
  );

  const client = yield* NodeHttpClient.makeUndici.pipe(
    Effect.provideService(NodeHttpClient.Dispatcher, dispatcher),
  );

  return yield* receive(client, href, http, redirects);
});

const receive = Effect.fnUntraced(function* (
  client: HttpClient.HttpClient,
  href: string,
  http: HttpResolverOptions,
  redirects: readonly string[],
): Effect.fn.Return<Hop, ResolverFailure | TimeoutFailure> {
  const request = client
    .pipe(
      HttpClient.retryTransient({
        schedule: Schedule.exponential("100 millis"),
        times: 3,
      }),
    )
    .get(href, { headers: http.headers || undefined })
    .pipe(Effect.mapError((cause) => resolverFailure(href, cause)));

  const timeout = http.timeout;

  const response = yield* typeof timeout === "number" && timeout > 0
    ? request.pipe(
        Effect.timeout(timeout),
        Effect.catchIf(Cause.isTimeoutError, () => Effect.fail(timeoutFailure(timeout))),
      )
    : request;

  if (response.status >= 400) {
    return yield* new ResolverFailure({
      message: `Error downloading ${href}: HTTP ERROR ${response.status}`,
      source: href,
      ioErrorCode: String(response.status),
    });
  }

  if (response.status >= 300) {
    if (http.redirects !== undefined && redirects.length > http.redirects) {
      return yield* new ResolverFailure({
        message: `Error downloading ${redirects[0]}. \nToo many redirects: \n  ${redirects.join(" \n  ")}`,
        source: href,
        ioErrorCode: String(response.status),
      });
    }

    const location = response.headers.location;

    if (!location) {
      return yield* new ResolverFailure({
        message: `Error downloading ${href}: HTTP ${response.status} redirect with no location header`,
        source: href,
        ioErrorCode: String(response.status),
      });
    }

    const redirectTo = new URL(location, href).href;

    const redirectOptions =
      new URL(redirectTo).origin === new URL(href).origin ? http : withoutSensitiveHeaders(http);

    return { kind: "redirect", href: redirectTo, http: redirectOptions };
  }

  const buffer = yield* response.arrayBuffer.pipe(
    Effect.mapError((cause) => resolverFailure(href, cause)),
  );

  return { kind: "body", bytes: new Uint8Array(buffer) };
});

function pinnedLookup(href: string, addresses: readonly ResolvedUrlAddress[]): LookupFunction {
  const expectedHostname = normalizeLookupHostname(new URL(href).hostname);

  return (hostname, options, callback) => {
    const normalizedHostname = normalizeLookupHostname(hostname);

    const requestedFamily =
      options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : options.family || 0;

    const candidates = addresses.filter(
      ({ family }) => requestedFamily === 0 || family === requestedFamily,
    );

    if (normalizedHostname !== expectedHostname || candidates.length === 0) {
      const error = new Error(
        `No validated address is available for ${hostname}`,
      ) as NodeJS.ErrnoException;

      error.code = "ENOTFOUND";
      callback(error, "", 0);
    } else if (options.all) {
      callback(null, candidates);
    } else {
      const selected = candidates[0]!;
      callback(null, selected.address, selected.family);
    }
  };
}

function normalizeLookupHostname(hostname: string): string {
  return hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "")
    .toLowerCase();
}

function withoutSensitiveHeaders(http: HttpResolverOptions): HttpResolverOptions {
  if (!http.headers) return http;
  const headers = new Headers(http.headers);
  headers.delete("authorization");
  headers.delete("proxy-authorization");
  headers.delete("cookie");
  return { ...http, headers: Object.fromEntries(headers.entries()) };
}

function resolverFailure(href: string, cause: unknown): ResolverFailure {
  const message = cause instanceof Error ? cause.message : String(cause);
  const ioErrorCode = nodeErrorCode(cause);

  return new ResolverFailure({
    message: message.startsWith("Error downloading")
      ? message
      : `Error downloading ${href}: ${message}`,
    source: href,
    cause,
    ...(ioErrorCode ? { ioErrorCode } : {}),
  });
}
