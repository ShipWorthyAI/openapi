import { describe, expect, it, vi } from "vitest";
import createClient, { type HttpMethod, type Middleware } from "../src/index.ts";
import type { paths } from "./fixtures.ts";

const runtime = globalThis as { process?: { versions?: { undici?: string } } };

type TestPaths = { "/session": { [Method in HttpMethod]: paths["/session"]["get"] } };

type BodyPaths = {
  "/items/{id}": {
    post: {
      parameters: {
        path: { id: string };
        query?: { tags: string[] };
        header?: { "X-Token": string };
      };
      requestBody: { content: { "application/json": { name: string } } };
      responses: paths["/session"]["get"]["responses"];
    };
  };
};

describe("client", () => {
  it("returns a native Promise and preserves the final Response", async () => {
    const response = Response.json({ ok: true });
    const fetch = vi.fn(async () => response);
    const client = createClient<TestPaths>({ baseUrl: "https://api.test", fetch });
    const result = client.GET("/session");

    expect(result).toBeInstanceOf(Promise);
    expect(await result).toEqual({ data: { ok: true }, response });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("accepts synchronous fetch stubs from JavaScript callers", async () => {
    const response = Response.json({ ok: true });

    const client = Reflect.apply(createClient, undefined, [
      { baseUrl: "https://api.test", fetch: () => response },
    ]);

    expect(await client.GET("/session")).toEqual({ data: { ok: true }, response });
  });

  it("preserves middleware order, receiver, metadata, and request replacement", async () => {
    const events: string[] = [];
    const metadata: Parameters<NonNullable<Middleware["onRequest"]>>[0][] = [];

    const fetch = vi.fn(async (request: Request) => {
      events.push("fetch");
      expect(request.headers.get("replaced")).toBe("yes");
      return Response.json({ ok: true });
    });

    const client = createClient<TestPaths>({ baseUrl: "https://api.test/", fetch });

    const middleware: Middleware = {
      onRequest(context) {
        expect(this).toBe(middleware);
        events.push("client request");
        metadata.push(context);
        const request = new Request(context.request);
        request.headers.set("replaced", "yes");
        return request;
      },
      onResponse(context) {
        events.push("client response");
        metadata.push(context);
      },
    };

    client.use(middleware);

    await client.GET("/session", {
      middleware: [
        {
          onRequest(context) {
            events.push("local request");
            metadata.push(context);
          },
          onResponse(context) {
            events.push("local response");
            metadata.push(context);
          },
        },
      ],
    });

    expect(events).toEqual([
      "client request",
      "local request",
      "fetch",
      "local response",
      "client response",
    ]);

    expect(new Set(metadata.map(({ id }) => id)).size).toBe(1);
    expect(metadata[0]?.id).not.toBe("");
    expect(metadata.every(({ options }) => Object.isFrozen(options))).toBe(true);
    expect(metadata[0]?.options.fetch).toBe(fetch);
    expect(metadata[0]?.options.baseUrl).toBe("https://api.test");
  });

  it("short-circuits a synthetic request response before fetch and response hooks", async () => {
    const response = Response.json({ ok: true });
    const skipped = vi.fn();
    const fetch = vi.fn();
    const client = createClient<TestPaths>({ baseUrl: "https://api.test", fetch });
    client.use({ onRequest: () => response, onResponse: skipped });
    client.use({ onRequest: skipped, onResponse: skipped });

    expect(await client.GET("/session")).toEqual({ data: { ok: true }, response });
    expect(fetch).not.toHaveBeenCalled();
    expect(skipped).not.toHaveBeenCalled();
  });

  it.each(["shadowed call", "null prototype"] as const)(
    "preserves decorated callbacks with %s through request, recovery, and response",
    async (decoration) => {
      const failure = new Error("network");
      const recovered = Response.json({ ok: false });
      const response = Response.json({ ok: true });
      const events: string[] = [];

      const middleware: Required<Middleware> = {
        onRequest({ request }) {
          expect(this).toBe(middleware);
          events.push("request");
          const replacement = new Request(request);
          replacement.headers.set("replaced", "yes");
          return replacement;
        },
        onError({ error, request }) {
          expect(this).toBe(middleware);
          expect(error).toBe(failure);
          expect(request.headers.get("replaced")).toBe("yes");
          events.push("recover");
          return recovered;
        },
        onResponse({ response: fetched }) {
          expect(this).toBe(middleware);
          expect(fetched).toBe(recovered);
          events.push("response");
          return response;
        },
      };

      const decorate = (callback: object) => {
        if (decoration === "shadowed call") {
          Object.defineProperty(callback, "call", { value: undefined });
        } else {
          Object.setPrototypeOf(callback, null);
        }
      };

      decorate(middleware.onRequest);
      decorate(middleware.onError);
      decorate(middleware.onResponse);

      const client = createClient<TestPaths>({
        baseUrl: "https://api.test",
        fetch: (request) => {
          expect(request.headers.get("replaced")).toBe("yes");
          events.push("fetch");
          throw failure;
        },
      });

      client.use(middleware);
      expect(await client.GET("/session")).toEqual({ data: { ok: true }, response });
      expect(events).toEqual(["request", "fetch", "recover", "response"]);
    },
  );

  it.each(["client", "request"] as const)(
    "runs array-backed %s middleware through request, recovery, and response",
    async (level) => {
      const recovered = Response.json({ ok: false });
      const response = Response.json({ ok: true });
      const events: string[] = [];

      const middleware: Middleware = Object.assign([], {
        onRequest() {
          expect(this).toBe(middleware);
          events.push("request");
        },
        onError() {
          expect(this).toBe(middleware);
          events.push("recover");
          return recovered;
        },
        onResponse() {
          expect(this).toBe(middleware);
          events.push("response");
          return response;
        },
      });

      const client = createClient<TestPaths>({
        baseUrl: "https://api.test",
        fetch: () => {
          events.push("fetch");
          throw new Error("network");
        },
      });

      if (level === "client") client.use(middleware);

      expect(
        await client.GET("/session", level === "request" ? { middleware: [middleware] } : {}),
      ).toEqual({ data: { ok: true }, response });

      expect(events).toEqual(["request", "fetch", "recover", "response"]);
    },
  );

  it("preserves URL and body serialization and header precedence", async () => {
    const fetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe("https://api.test/items/a%2Fb?tags=one&tags=two");
      expect(request.headers.get("X-Token")).toBe("parameter");
      expect(request.headers.get("Content-Type")).toBe("application/json");
      expect(await request.text()).toBe('{"name":"test"}');
      return Response.json({ ok: true });
    });

    const client = createClient<BodyPaths>({
      baseUrl: "https://api.test/",
      fetch,
      headers: { "X-Token": "client" },
    });

    await client.POST("/items/{id}", {
      params: {
        path: { id: "a/b" },
        query: { tags: ["one", "two"] },
        header: { "X-Token": "parameter" },
      },
      headers: { "X-Token": "request" },
      body: { name: "test" },
    });

    expect(fetch).toHaveBeenCalledOnce();
  });

  it("isolates per-request transports during concurrent calls", async () => {
    const first = Promise.withResolvers<Response>();
    const second = Promise.withResolvers<Response>();
    const baseFetch = vi.fn();
    const client = createClient<TestPaths>({ baseUrl: "https://api.test", fetch: baseFetch });
    const firstResult = client.GET("/session", { fetch: () => first.promise });
    const secondResult = client.GET("/session", { fetch: () => second.promise });
    second.resolve(Response.json({ ok: false }));
    first.resolve(Response.json({ ok: true }));
    expect((await firstResult).data).toEqual({ ok: true });
    expect((await secondResult).data).toEqual({ ok: false });
    expect(baseFetch).not.toHaveBeenCalled();
  });

  it.each([
    "fetch",
    "request",
    "error",
    "response",
    "text reader",
    "json reader",
    "error reader",
  ] as const)("preserves native awaiting of a decorated Promise from %s", async (stage) => {
    const failure = new Error("network");
    const observerFailure = new Error("tracing observer");

    const observer = vi.fn<() => void>(() => {
      throw observerFailure;
    });

    const decorate = <A>(promise: Promise<A>): Promise<A> => {
      // oxlint-disable-next-line unicorn/no-thenable -- Reproduce a caller-decorated native Promise.
      return Object.defineProperty(promise, "then", {
        value(this: Promise<A>, ...args: Parameters<Promise<A>["then"]>) {
          observer();
          return Promise.prototype.then.call(this, ...args);
        },
      });
    };

    const response = Response.json({ ok: true }, { status: stage === "error reader" ? 400 : 200 });

    if (stage === "text reader" || stage === "error reader") {
      response.text = () => decorate(Promise.resolve('{"ok":true}'));
    } else if (stage === "json reader") {
      response.headers.set("Content-Length", "11");
      response.json = () => decorate(Promise.resolve({ ok: true }));
    }

    // Spies subscribe to returned Promises, so track this native callback directly.
    let errorCalls = 0;

    const onError = ({ error }: { error: unknown }) => {
      errorCalls++;
      expect(error).toBe(failure);
      return stage === "error" ? decorate(Promise.resolve(response)) : undefined;
    };

    const client = createClient<TestPaths>({
      baseUrl: "https://api.test",
      fetch: () => {
        if (stage === "error") throw failure;
        const pending = Promise.resolve(response);
        return stage === "fetch" ? decorate(pending) : pending;
      },
    });

    client.use({
      onRequest: ({ request }) =>
        stage === "request" ? decorate(Promise.resolve(new Request(request))) : undefined,
      onError,
      onResponse: () => (stage === "response" ? decorate(Promise.resolve(response)) : undefined),
    });

    expect(await client.GET("/session")).toEqual(
      stage === "error reader"
        ? { error: { ok: true }, response }
        : { data: { ok: true }, response },
    );

    expect(observer).not.toHaveBeenCalled();
    expect(errorCalls).toBe(stage === "error" ? 1 : 0);
  });

  it("leaves then metadata on an already-fulfilled transport value untouched", async () => {
    const response = Response.json({ ok: true });
    const pending = Promise.resolve(response);

    const observer = vi.fn(() => {
      throw new Error("response metadata must not be observed");
    });

    // oxlint-disable-next-line unicorn/no-thenable -- Exercise metadata added after native Promise fulfillment.
    Object.defineProperty(response, "then", { get: observer });

    const client = createClient<TestPaths>({ baseUrl: "https://api.test", fetch: () => pending });
    expect(await client.GET("/session")).toEqual({ data: { ok: true }, response });
    expect(observer).not.toHaveBeenCalled();
  });

  it("keeps serializer failures outside fetch recovery", async () => {
    const failure = new Error("serializer");
    const fetch = vi.fn();
    const onError = vi.fn();

    const client = createClient<TestPaths>({
      baseUrl: "https://api.test",
      fetch,
      querySerializer: () => {
        throw failure;
      },
    });

    client.use({ onError });
    await expect(client.GET("/session")).rejects.toBe(failure);
    expect(fetch).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("recovers fetch errors in reverse order and then runs response hooks", async () => {
    const original = new TypeError("network");
    const replacement = new Error("transformed");
    const recovered = Response.json({ ok: true });
    const events: string[] = [];
    const skipped = vi.fn();

    const client = createClient<TestPaths>({
      baseUrl: "https://api.test",
      fetch: async () => {
        throw original;
      },
    });

    client.use({ onError: skipped });

    client.use({
      onError({ error }) {
        events.push("recover");
        expect(error).toBe(replacement);
        return recovered;
      },
      onResponse: () => {
        events.push("response");
      },
    });

    const result = await client.GET("/session", {
      middleware: [
        {
          onError({ error }) {
            events.push("transform");
            expect(error).toBe(original);
            return replacement;
          },
        },
      ],
    });

    expect(result.response).toBe(recovered);
    expect(events).toEqual(["transform", "recover", "response"]);
    expect(skipped).not.toHaveBeenCalled();
  });

  it("keeps synchronous transport throws in immediate error recovery", async () => {
    const failure = new Error("network");
    const response = Response.json({ ok: true });

    const onError = vi.fn(({ error }: { error: unknown }) => {
      expect(error).toBe(failure);
      return response;
    });

    const client = createClient<TestPaths>({
      baseUrl: "https://api.test",
      fetch: () => {
        throw failure;
      },
    });

    client.use({ onError });
    const result = client.GET("/session");
    expect(onError).toHaveBeenCalledOnce();
    expect(await result).toEqual({ data: { ok: true }, response });
  });

  it("assimilates JavaScript transport thenables once with their native receiver", async () => {
    const response = Response.json({ ok: true });

    const then = vi.fn(function (this: unknown, resolve: (response: Response) => void) {
      expect(this).toBe(thenable);
      resolve(response);
    });

    // oxlint-disable-next-line unicorn/no-thenable -- Exercise a JavaScript transport's native thenable assimilation.
    const thenable = { then };

    const client = Reflect.apply(createClient, undefined, [
      { baseUrl: "https://api.test", fetch: () => thenable },
    ]);

    expect(await client.GET("/session")).toEqual({ data: { ok: true }, response });
    expect(then).toHaveBeenCalledOnce();
  });

  it.each([new TypeError("network"), "failure", undefined, null, false, 0])(
    "preserves an unhandled rejection value (%s) without retries",
    async (failure) => {
      const fetch = vi.fn(async () => {
        throw failure;
      });

      const client = createClient<TestPaths>({ baseUrl: "https://api.test", fetch });
      await expect(client.GET("/session")).rejects.toBe(failure);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps callback failures outside fetch error recovery", async () => {
    const failure = new Error("middleware");
    const onError = vi.fn();
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    const client = createClient<TestPaths>({ baseUrl: "https://api.test", fetch });

    client.use({
      onRequest: () => {
        throw failure;
      },
      onError,
    });

    await expect(client.GET("/session")).rejects.toBe(failure);
    expect(fetch).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("uses request-level fetch and preserves custom Request constructors and extensions", async () => {
    class CustomRequest extends Request {}
    const baseFetch = vi.fn();

    const fetch = vi.fn(async (request: Request) => {
      expect(request).toBeInstanceOf(CustomRequest);
      expect(Reflect.get(request, "custom")).toBe("value");
      expect(Reflect.has(request, "fetch")).toBe(false);
      return Response.json({ ok: true });
    });

    const extension = { dispatcher: {} };

    const client = createClient<TestPaths>({
      baseUrl: "https://api.test",
      fetch: baseFetch,
      Request: CustomRequest,
      requestInitExt: extension,
    });

    await client.GET("/session", { fetch, custom: "value" });

    expect(baseFetch).not.toHaveBeenCalled();

    expect(fetch).toHaveBeenCalledWith(
      expect.any(CustomRequest),
      runtime.process?.versions?.undici ? extension : undefined,
    );
  });

  it("forwards abort reasons through native fetch and allows onError recovery", async () => {
    const controller = new AbortController();
    const failure = new Error("cancelled");
    const started = Promise.withResolvers<Request>();

    const fetch = (request: Request) => {
      started.resolve(request);

      return new Promise<Response>((_, reject) => {
        request.signal.addEventListener("abort", () => reject(request.signal.reason), {
          once: true,
        });
      });
    };

    const onError = vi.fn(({ error }: { error: unknown }) => {
      expect(error).toBe(failure);
      return Response.json({ ok: true });
    });

    const client = createClient<TestPaths>({ baseUrl: "https://api.test", fetch });
    client.use({ onError });
    const result = client.GET("/session", { signal: controller.signal });
    const request = await started.promise;
    controller.abort(failure);

    expect((await result).data).toEqual({ ok: true });
    expect(request.signal.reason).toBe(failure);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("still runs request hooks for an already-aborted signal", async () => {
    const controller = new AbortController();
    const failure = new DOMException("cancelled", "AbortError");
    controller.abort(failure);
    const onRequest = vi.fn();

    const client = createClient<TestPaths>({
      baseUrl: "https://api.test",
      signal: controller.signal,
      fetch: async (request) => {
        throw request.signal.reason;
      },
    });

    client.use({ onRequest });

    await expect(client.GET("/session")).rejects.toBe(failure);
    expect(onRequest).toHaveBeenCalledOnce();
  });

  it("leaves a returned stream alive after the request completes", async () => {
    const controller = new AbortController();
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let requestSignal: AbortSignal | undefined;
    const cancel = vi.fn();

    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        bodyController = value;
      },
      cancel,
    });

    const client = createClient<TestPaths>({
      baseUrl: "https://api.test",
      fetch: async (request) => {
        requestSignal = request.signal;
        return new Response(stream);
      },
    });

    const result = await client.GET("/session", { parseAs: "stream", signal: controller.signal });
    expect(result.data).toBe(stream);
    expect(requestSignal?.aborted).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    bodyController?.enqueue(new Uint8Array([42]));
    const reader = result.data?.getReader();
    expect(await reader?.read()).toEqual({ done: false, value: new Uint8Array([42]) });
    await reader?.cancel();
  });

  it.each([
    [new Response(null, { status: 204 }), { data: undefined }],
    [new Response("", { status: 200 }), { data: undefined }],
    [new Response("", { status: 400 }), { error: undefined }],
    [Response.json({ message: "bad" }, { status: 400 }), { error: { message: "bad" } }],
    [new Response("bad", { status: 500 }), { error: "bad" }],
  ])("preserves empty and HTTP-error response behavior", async (response, expected) => {
    const client = createClient<TestPaths>({
      baseUrl: "https://api.test",
      fetch: async () => response.clone(),
    });

    expect(await client.GET("/session")).toMatchObject(expected);
  });

  it("does not consume a HEAD response body", async () => {
    const response = Response.json({ ok: true });

    const client = createClient<TestPaths>({
      baseUrl: "https://api.test",
      fetch: async () => response,
    });

    expect(await client.HEAD("/session")).toEqual({ data: undefined, response });
    expect(response.bodyUsed).toBe(false);
  });

  it.each([new Headers(), new Headers({ "Content-Length": "3" })])(
    "rejects invalid successful JSON (%s)",
    async (headers) => {
      const onError = vi.fn();

      const client = createClient<TestPaths>({
        baseUrl: "https://api.test",
        fetch: async () => new Response("bad", { headers }),
      });

      client.use({ onError });
      await expect(client.GET("/session")).rejects.toBeInstanceOf(SyntaxError);
      expect(onError).not.toHaveBeenCalled();
    },
  );

  it("keeps synchronous middleware registration and ejection", async () => {
    const onRequest = vi.fn();
    const middleware = { onRequest };

    const client = createClient<TestPaths>({
      baseUrl: "https://api.test",
      fetch: async () => Response.json({ ok: true }),
    });

    expect(client.use(middleware)).toBeUndefined();
    await client.GET("/session");
    expect(onRequest).toHaveBeenCalledOnce();
    expect(client.eject(middleware)).toBeUndefined();
    await client.GET("/session");
    expect(onRequest).toHaveBeenCalledOnce();

    expect(() => Reflect.apply(client.use.bind(client), client, [{}])).toThrow(
      "Middleware must be an object",
    );
  });

  it.each([
    ["onRequest", "onRequest: must return new Request() or Response() when modifying the request"],
    ["onResponse", "onResponse: must return new Response() when modifying the response"],
    ["onError", "onError: must return new Response() or instance of Error"],
  ])("preserves invalid %s return errors", async (hook, message) => {
    const client = createClient<TestPaths>({
      baseUrl: "https://api.test",
      fetch: async () => {
        if (hook === "onError") throw new Error("network");
        return Response.json({ ok: true });
      },
    });

    Reflect.apply(client.use.bind(client), client, [{ [hook]: () => ({ invalid: true }) }]);
    await expect(client.GET("/session")).rejects.toThrow(message);
  });
});
