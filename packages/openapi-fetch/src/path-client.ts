import createClient from "./client.js";
import type { Client, ClientOptions, PathBasedClient } from "./types.js";
import type { MediaType } from "@shipworthy/openapi-typescript-helpers";

type CoreClient = {
  GET: (url: string, init?: unknown) => unknown;
  PUT: (url: string, init?: unknown) => unknown;
  POST: (url: string, init?: unknown) => unknown;
  DELETE: (url: string, init?: unknown) => unknown;
  OPTIONS: (url: string, init?: unknown) => unknown;
  HEAD: (url: string, init?: unknown) => unknown;
  PATCH: (url: string, init?: unknown) => unknown;
  TRACE: (url: string, init?: unknown) => unknown;
};

class PathCallForwarder {
  constructor(
    private client: CoreClient,
    private url: string,
  ) {}

  GET = (init?: unknown) => {
    return this.client.GET(this.url, init);
  };
  PUT = (init?: unknown) => {
    return this.client.PUT(this.url, init);
  };
  POST = (init?: unknown) => {
    return this.client.POST(this.url, init);
  };
  DELETE = (init?: unknown) => {
    return this.client.DELETE(this.url, init);
  };
  OPTIONS = (init?: unknown) => {
    return this.client.OPTIONS(this.url, init);
  };
  HEAD = (init?: unknown) => {
    return this.client.HEAD(this.url, init);
  };
  PATCH = (init?: unknown) => {
    return this.client.PATCH(this.url, init);
  };
  TRACE = (init?: unknown) => {
    return this.client.TRACE(this.url, init);
  };
}

class PathClientProxyHandler {
  client: Record<string, PathCallForwarder> | null = null;

  // Assume the property is an URL.
  get(coreClient: CoreClient, url: string | symbol) {
    const forwarder = new PathCallForwarder(coreClient, url as string);
    (this.client as Record<string, PathCallForwarder>)[url as string] = forwarder;
    return forwarder;
  }
}

/**
 * Wrap openapi-fetch client to support a path based API.
 */
export function wrapAsPathBasedClient<Paths extends {}, Media extends MediaType = MediaType>(
  coreClient: Client<Paths, Media>,
): PathBasedClient<Paths, Media> {
  const handler = new PathClientProxyHandler();
  const proxy = new Proxy(coreClient, handler as ProxyHandler<Client<Paths, Media>>);

  // Put the proxy on the prototype chain of the actual client.
  // This means if we do not have a memoized PathCallForwarder,
  // we fall back to the proxy to synthesize it.
  // However, the proxy itself is not on the hot-path (if we fetch the same
  // endpoint multiple times, only the first call will hit the proxy).
  function ClientCtor() {}
  ClientCtor.prototype = proxy;

  const client = new (ClientCtor as unknown as new () => Record<string, PathCallForwarder>)();

  // Feed the client back to the proxy handler so it can store the generated
  // PathCallForwarder.
  handler.client = client;

  return client as PathBasedClient<Paths, Media>;
}

/**
 * Convenience method to an openapi-fetch path based client.
 * Strictly equivalent to `wrapAsPathBasedClient(createClient(...))`.
 */
export function createPathBasedClient<Paths extends {}, Media extends MediaType = MediaType>(
  clientOptions?: ClientOptions,
): PathBasedClient<Paths, Media> {
  return wrapAsPathBasedClient(createClient<Paths, Media>(clientOptions));
}
