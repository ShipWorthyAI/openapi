import type { MediaType } from "./helpers.ts";
import { mergeHeaders } from "./headers.ts";
import { createCaseMappingMiddleware } from "./middleware/transform-casing.ts";
import { defaultBodySerializer } from "./serializers/body.ts";
import { serializeCookieParams } from "./serializers/cookie.ts";
import { defaultPathSerializer } from "./serializers/path.ts";
import { createQuerySerializer } from "./serializers/query.ts";
import { createFinalURL, removeTrailingSlash } from "./serializers/url.ts";
import type {
  Client,
  ClientOptions,
  HeadersOptions,
  MergedOptions,
  Middleware,
  MiddlewareRequestParams,
  MiddlewareResult,
  ParseAs,
  PathSerializer,
  QuerySerializer,
  QuerySerializerOptions,
} from "./types.ts";

interface CoreFetchOptions extends Omit<RequestInit, "body" | "headers"> {
  baseUrl?: string;
  fetch?: ClientOptions["fetch"] | typeof globalThis.fetch;
  Request?: typeof Request;
  headers?: HeadersOptions;
  params?: MiddlewareRequestParams;
  parseAs?: ParseAs;
  querySerializer?: QuerySerializer<unknown> | QuerySerializerOptions;
  bodySerializer?: (body: unknown, headers?: Headers) => unknown;
  pathSerializer?: PathSerializer;
  body?: unknown;
  middleware?: Middleware[];
}

type NodeProcess = {
  versions?: {
    node?: string;
    undici?: string;
  };
};

type FetchWithExt = (input: Request, init?: Record<string, unknown>) => Promise<Response>;

function supportsRequestInitExt() {
  const nodeProcess = (globalThis as typeof globalThis & { process?: NodeProcess }).process;

  return (
    typeof nodeProcess === "object" &&
    Number.parseInt(nodeProcess?.versions?.node?.substring(0, 2) ?? "") >= 18 &&
    nodeProcess?.versions?.undici
  );
}

/** Returns a cheap, non-cryptographically-secure random ID. */
function randomID() {
  return Math.random().toString(36).slice(2, 11);
}

/**
 * Create an openapi-fetch client.
 */
export default function createClient<Paths extends {}, Media extends MediaType = MediaType>(
  clientOptions?: ClientOptions,
): Client<Paths, Media> {
  let {
    baseUrl = "",
    Request: CustomRequest = globalThis.Request,
    fetch: baseFetch = globalThis.fetch,
    querySerializer: globalQuerySerializer,
    bodySerializer: globalBodySerializer,
    pathSerializer: globalPathSerializer,
    caseMapping,
    headers: baseHeaders,
    requestInitExt,
    ...baseOptions
  } = { ...clientOptions };

  requestInitExt = supportsRequestInitExt() ? requestInitExt : undefined;
  baseUrl = removeTrailingSlash(baseUrl);
  const globalMiddlewares: Middleware[] = [];

  if (caseMapping !== undefined) {
    globalMiddlewares.push(createCaseMappingMiddleware(caseMapping));
  }

  /**
   * Per-request fetch (keeps settings created in createClient()
   */
  async function coreFetch(schemaPath: string, fetchOptions?: CoreFetchOptions) {
    const {
      baseUrl: localBaseUrl,
      fetch = baseFetch,
      Request = CustomRequest,
      headers,
      params: initialParams = {},
      parseAs = "json",
      querySerializer: requestQuerySerializer,
      bodySerializer = (globalBodySerializer ?? defaultBodySerializer) as NonNullable<
        CoreFetchOptions["bodySerializer"]
      >,
      pathSerializer: requestPathSerializer,
      body: initialBody,
      middleware: requestMiddlewares = [],
      ...init
    } = fetchOptions || {};

    let finalBaseUrl = baseUrl;

    if (localBaseUrl) {
      finalBaseUrl = removeTrailingSlash(localBaseUrl) ?? baseUrl;
    }

    let querySerializer: QuerySerializer<unknown> =
      typeof globalQuerySerializer === "function"
        ? globalQuerySerializer
        : createQuerySerializer(globalQuerySerializer);

    if (requestQuerySerializer) {
      querySerializer =
        typeof requestQuerySerializer === "function"
          ? requestQuerySerializer
          : createQuerySerializer({
              ...(typeof globalQuerySerializer === "object" ? globalQuerySerializer : {}),
              ...requestQuerySerializer,
            });
    }

    const pathSerializer: PathSerializer =
      requestPathSerializer || globalPathSerializer || defaultPathSerializer;

    // Snapshot middleware before any hook runs so registration changes affect later requests only.
    const finalMiddlewares = [...globalMiddlewares, ...requestMiddlewares];
    const method = String(init.method ?? "GET").toUpperCase();
    let id: string | undefined;
    let options: MergedOptions | undefined;
    let params = initialParams;
    let body = initialBody;

    if (finalMiddlewares.length) {
      id = randomID();

      options = Object.freeze({
        baseUrl: finalBaseUrl,
        fetch,
        parseAs,
        querySerializer,
        bodySerializer,
        pathSerializer,
      }) as MergedOptions;

      for (const m of finalMiddlewares) {
        if (m && typeof m === "object" && typeof m.onRequestInit === "function") {
          const result = await m.onRequestInit({
            schemaPath,
            method,
            input: { params, body },
            headers: mergeHeaders(baseHeaders, headers, params.header),
            options,
            id,
          });

          if (result !== undefined) {
            if (
              !result ||
              typeof result !== "object" ||
              !("params" in result) ||
              !("body" in result)
            ) {
              throw new Error("onRequestInit: must return request input when modifying it");
            }

            params = result.params;
            body = result.body;
          }
        }
      }
    }

    const serializedBody =
      body === undefined
        ? undefined
        : bodySerializer(
            body,
            // Note: we declare mergeHeaders() both here and below because it’s a bit of a chicken-or-egg situation:
            // bodySerializer() needs all headers so we aren’t dropping ones set by the user, however,
            // the result of this ALSO sets the lowest-priority content-type header. So we re-merge below,
            // setting the content-type at the very beginning to be overwritten.
            // Lastly, based on the way headers work, it's not a simple "present-or-not" check because null intentionally un-sets headers.
            mergeHeaders(baseHeaders, headers, params.header),
          );

    const finalHeaders = mergeHeaders(
      // with no body, we should not to set Content-Type
      serializedBody === undefined ||
        // if serialized body is FormData; browser will correctly set Content-Type & boundary expression
        serializedBody instanceof FormData
        ? {}
        : {
            "Content-Type": "application/json",
          },
      baseHeaders,
      headers,
      params.header,
    );

    // cookie params are appended to any Cookie header supplied through headers
    const serializedCookies = serializeCookieParams(params.cookie);

    if (serializedCookies) {
      const existingCookie = finalHeaders.get("Cookie");

      finalHeaders.set(
        "Cookie",
        existingCookie ? `${existingCookie}; ${serializedCookies}` : serializedCookies,
      );
    }

    const requestInit: RequestInit = {
      redirect: "follow",
      ...baseOptions,
      ...init,
      body: serializedBody as BodyInit | undefined,
      headers: finalHeaders,
    };

    let request: Request = new Request(
      createFinalURL(schemaPath, {
        baseUrl: finalBaseUrl,
        params,
        querySerializer,
        pathSerializer,
      }),
      requestInit,
    );

    let response: Response | undefined;

    /** Add custom parameters to Request object */
    for (const key in init) {
      if (!(key in request)) {
        (request as unknown as Record<string, unknown>)[key] = (init as Record<string, unknown>)[
          key
        ];
      }
    }

    if (finalMiddlewares.length) {
      // middleware (request)
      for (const m of finalMiddlewares) {
        if (m && typeof m === "object" && typeof m.onRequest === "function") {
          const result = await m.onRequest({
            request,
            schemaPath,
            params,
            options: options as MergedOptions,
            id: id as string,
          });

          if (result) {
            if (result instanceof Request) {
              request = result;
            } else if (result instanceof Response) {
              response = result;
              break;
            } else {
              throw new Error(
                "onRequest: must return new Request() or Response() when modifying the request",
              );
            }
          }
        }
      }
    }

    if (!response) {
      // fetch!
      try {
        response = await (fetch as FetchWithExt)(request, requestInitExt);
      } catch (error) {
        let errorAfterMiddleware: unknown = error;

        // middleware (error)
        // execute in reverse-array order (first priority gets last transform)
        if (finalMiddlewares.length) {
          for (let i = finalMiddlewares.length - 1; i >= 0; i--) {
            const m = finalMiddlewares[i];

            if (m && typeof m === "object" && typeof m.onError === "function") {
              const result = await m.onError({
                request,
                error: errorAfterMiddleware,
                schemaPath,
                params: params as MiddlewareRequestParams,
                options: options as MergedOptions,
                id: id as string,
              });

              if (result) {
                // if error is handled by returning a response, skip remaining middleware
                if (result instanceof Response) {
                  response = result;
                  break;
                }

                if (result instanceof Error) {
                  errorAfterMiddleware = result;
                  continue;
                }

                throw new Error("onError: must return new Response() or instance of Error");
              }
            }
          }
        }

        // rethrow error if not handled by middleware (the rejection value may be falsy)
        if (!response) {
          throw errorAfterMiddleware;
        }
      }

      // middleware (response)
      // execute in reverse-array order (first priority gets last transform)
      if (finalMiddlewares.length) {
        for (let i = finalMiddlewares.length - 1; i >= 0; i--) {
          const m = finalMiddlewares[i];

          if (m && typeof m === "object" && typeof m.onResponse === "function") {
            const result = await m.onResponse({
              request,
              response: response as Response,
              schemaPath,
              params: params as MiddlewareRequestParams,
              options: options as MergedOptions,
              id: id as string,
            });

            if (result) {
              if (!(result instanceof Response)) {
                throw new Error(
                  "onResponse: must return new Response() when modifying the response",
                );
              }

              response = result;
            }
          }
        }
      }
    }

    const finalResponse = response as Response;
    const contentLength = finalResponse.headers.get("Content-Length");
    let parsedResult: MiddlewareResult;

    // handle empty content
    if (
      finalResponse.status === 204 ||
      request.method === "HEAD" ||
      (contentLength === "0" &&
        !finalResponse.headers.get("Transfer-Encoding")?.includes("chunked"))
    ) {
      parsedResult = finalResponse.ok
        ? { data: undefined, response: finalResponse }
        : { error: undefined, response: finalResponse };
    } else if (finalResponse.ok) {
      // parse response (falling back to .text() when necessary)
      const getResponseData = async () => {
        // if "stream", skip parsing entirely
        if (parseAs === "stream") {
          return finalResponse.body;
        }

        if (parseAs === "json" && !contentLength) {
          // use text() when no content-length is provided to avoid errors parsing empty bodies (200 with no content)
          const raw = await finalResponse.text();
          return raw ? JSON.parse(raw) : undefined;
        }

        return await finalResponse[parseAs as Exclude<ParseAs, "stream">]();
      };

      parsedResult = { data: await getResponseData(), response: finalResponse };
    } else {
      // handle errors (use text() when no content-length to safely handle empty bodies from proxies)
      const raw = await finalResponse.text();

      if (!raw) {
        parsedResult = { error: undefined, response: finalResponse };
      } else {
        let error: unknown = raw;

        try {
          error = JSON.parse(raw); // attempt to parse as JSON
        } catch {
          // noop - keep as raw text
        }

        parsedResult = { error, response: finalResponse };
      }
    }

    // Parsed-result hooks also run for responses returned by onRequest and onError.
    for (let index = finalMiddlewares.length - 1; index >= 0; index--) {
      const m = finalMiddlewares[index];

      if (m && typeof m === "object" && typeof m.onResult === "function") {
        const update = await m.onResult({
          request,
          schemaPath,
          method,
          params,
          options: options as MergedOptions,
          id: id as string,
          result: parsedResult,
        });

        if (update !== undefined) {
          if (
            !update ||
            typeof update !== "object" ||
            Object.keys(update).some((key) => key !== "data" && key !== "error")
          ) {
            throw new Error("onResult: must return data and/or error when modifying the result");
          }

          parsedResult = { ...parsedResult, ...update, response: finalResponse };
        }
      }
    }

    return parsedResult;
  }

  const client = {
    request(method: string, url: string, init?: CoreFetchOptions) {
      return coreFetch(url, { ...init, method: method.toUpperCase() });
    },
    /** Call a GET endpoint */
    GET(url: string, init?: CoreFetchOptions) {
      return coreFetch(url, { ...init, method: "GET" });
    },
    /** Call a PUT endpoint */
    PUT(url: string, init?: CoreFetchOptions) {
      return coreFetch(url, { ...init, method: "PUT" });
    },
    /** Call a POST endpoint */
    POST(url: string, init?: CoreFetchOptions) {
      return coreFetch(url, { ...init, method: "POST" });
    },
    /** Call a DELETE endpoint */
    DELETE(url: string, init?: CoreFetchOptions) {
      return coreFetch(url, { ...init, method: "DELETE" });
    },
    /** Call a OPTIONS endpoint */
    OPTIONS(url: string, init?: CoreFetchOptions) {
      return coreFetch(url, { ...init, method: "OPTIONS" });
    },
    /** Call a HEAD endpoint */
    HEAD(url: string, init?: CoreFetchOptions) {
      return coreFetch(url, { ...init, method: "HEAD" });
    },
    /** Call a PATCH endpoint */
    PATCH(url: string, init?: CoreFetchOptions) {
      return coreFetch(url, { ...init, method: "PATCH" });
    },
    /** Call a TRACE endpoint */
    TRACE(url: string, init?: CoreFetchOptions) {
      return coreFetch(url, { ...init, method: "TRACE" });
    },
    /** Register middleware */
    use(...middleware: Middleware[]) {
      for (const m of middleware) {
        if (!m) {
          continue;
        }

        if (
          typeof m !== "object" ||
          !(
            "onRequestInit" in m ||
            "onRequest" in m ||
            "onResponse" in m ||
            "onError" in m ||
            "onResult" in m
          )
        ) {
          throw new Error("Middleware must be an object with a supported hook");
        }

        globalMiddlewares.push(m);
      }
    },
    /** Unregister middleware */
    eject(...middleware: Middleware[]) {
      for (const m of middleware) {
        const i = globalMiddlewares.indexOf(m);

        if (i !== -1) {
          globalMiddlewares.splice(i, 1);
        }
      }
    },
  };

  return client as Client<Paths, Media>;
}
