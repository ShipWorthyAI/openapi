import { schema } from "./fixtures";
import { generatedFixture } from "./generated-fixture";
import {
  InfiniteQueryObserver,
  MutationObserver,
  QueryClient,
  QueryObserver,
  skipToken,
} from "@tanstack/react-query";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";

let fixture: Awaited<ReturnType<typeof generatedFixture>>;

before(async () => {
  fixture = await generatedFixture(schema);
});

after(async () => {
  await fixture?.dispose();
});

function json(value: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

function setup(
  fetch: (request: Request) => Promise<Response>,
  authToken?: () => string | undefined | Promise<string | undefined>,
) {
  const client = fixture.createFixtureApiClient({
    baseUrl: "http://hotels.test",
    fetch,
    authToken,
    querySerializer: { array: { style: "form", explode: false } },
  });

  const utils = fixture.createFixtureApiQueryUtils(client, {
    prefix: "hotels",
  });

  const getItem = async (input: { id: string }, signal = new AbortController().signal) => {
    const options = utils.getItem.queryOptions({ input: { path: input } });

    return options.queryFn({
      queryKey: options.queryKey,
      signal,
      meta: undefined,
    });
  };

  return { client, utils, getItem };
}

test("grouped requests pass through with inherited types and configured serialization", async () => {
  const requests: Request[] = [];

  const { utils } = setup(async (request) => {
    requests.push(request);

    return request.method === "POST"
      ? new Response(null, { status: 204 })
      : json({ name: "Hotel" });
  });

  const cache = new QueryClient();

  try {
    assert.deepEqual(
      await cache.fetchQuery(
        utils.getItem.queryOptions({
          input: {
            path: { id: "hotel/1" },
            query: { tags: ["one", "two"], filter: { country: "US" } },
          },
        }),
      ),
      { name: "Hotel" },
    );

    assert.equal(
      requests[0]!.url,
      "http://hotels.test/items/hotel%2F1?tags=one,two&filter[country]=US",
    );

    assert.equal(
      await utils.updateItem.mutationOptions().mutationFn({
        path: { id: "hotel_1" },
        query: { revision: 2 },
        body: { name: "Hotel", note: "new" },
        header: { "Idempotency-Key": "attempt-1" },
      }),
      null,
    );

    assert.equal(requests[1]!.url, "http://hotels.test/items/hotel_1?revision=2");
    assert.equal(requests[1]!.headers.get("Idempotency-Key"), "attempt-1");
    assert.deepEqual(await requests[1]!.json(), { name: "Hotel", note: "new" });
  } finally {
    cache.clear();
  }
});

test("each request gets the current token and removed tokens clear Authorization", async () => {
  const authorization: (string | null)[] = [];
  let token: string | undefined = "first";

  const { getItem } = setup(
    async (request) => {
      authorization.push(request.headers.get("Authorization"));
      return json({ name: "Hotel" });
    },
    async () => token,
  );

  await getItem({ id: "1" });
  token = "second";
  await getItem({ id: "1" });
  token = undefined;
  await getItem({ id: "1" });
  assert.deepEqual(authorization, ["Bearer first", "Bearer second", null]);
});

test("failed HTTP responses reject, including falsy error bodies", async () => {
  const { getItem } = setup(async () => json(false, { status: 400 }));
  await assert.rejects(getItem({ id: "1" }), (error) => error === false);
});

test("query cancellation reaches fetch and abort during auth prevents fetch", async () => {
  let aborted = false;
  let started!: () => void;

  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });

  const { utils } = setup(
    (request) =>
      new Promise((_, reject) => {
        request.signal!.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });

        started();
      }),
  );

  const cache = new QueryClient();

  const pending = cache
    .fetchQuery(utils.getItem.queryOptions({ input: { path: { id: "1" } } }))
    .catch(() => undefined);

  await ready;
  await cache.cancelQueries({ queryKey: utils.getItem.key() });
  await pending;
  assert.equal(aborted, true);
  cache.clear();
  let release!: (token: string) => void;

  const token = new Promise<string>((resolve) => {
    release = resolve;
  });

  let fetches = 0;

  const waiting = setup(
    async () => {
      fetches++;
      return json({});
    },
    () => token,
  );

  const controller = new AbortController();
  const request = waiting.getItem({ id: "1" }, controller.signal);
  controller.abort();
  release("old-session");
  await assert.rejects(request, { name: "AbortError" });
  assert.equal(fetches, 0);
});

test("keys separate namespaces and query kinds, support partial filters, and omit credentials", async () => {
  const { utils, client } = setup(async () => json({ name: "Hotel" }));
  const other = fixture.createFixtureApiQueryUtils(client, { prefix: "other" });
  const cache = new QueryClient();

  const first = utils.getItem.queryKey({
    input: { path: { id: "1" }, query: { tags: ["one"] } },
  });

  const second = utils.getItem.queryKey({ input: { path: { id: "2" } } });

  const infinite = utils.getItem.infiniteKey({
    input: (_: number) => ({ path: { id: "1" } }),
    initialPageParam: 0,
  });

  const different = other.getItem.queryKey({ input: { path: { id: "1" } } });
  for (const key of [first, second, different]) cache.setQueryData(key, { name: "Hotel" });
  cache.setQueryData(infinite, { pages: [{ name: "Hotel" }], pageParams: [0] });

  await cache.invalidateQueries({
    queryKey: utils.getItem.key({ input: { path: { id: "1" } } }),
  });

  assert.equal(cache.getQueryState(first)!.isInvalidated, true);
  assert.equal(cache.getQueryState(infinite)!.isInvalidated, true);
  assert.equal(cache.getQueryState(second)!.isInvalidated, false);
  assert.equal(cache.getQueryState(different)!.isInvalidated, false);

  assert.equal(
    cache.getQueryCache().findAll({ queryKey: utils.getItem.key({ type: "query" }) }).length,
    2,
  );

  const headers = {
    "Idempotency-Key": "attempt",
    Authorization: "secret",
    Cookie: "session=secret",
    "Accept-Language": "en",
  };

  const key = utils.updateItem.queryKey({
    input: { path: { id: "1" }, body: { name: "Hotel" }, header: headers },
  });

  assert.ok(!JSON.stringify(key).includes("secret"));
  assert.ok(JSON.stringify(key).includes("accept-language"));
  assert.deepEqual(utils.listItems.queryKey(), utils.listItems.queryKey({ input: {} }));
  cache.clear();
});

test("skipToken disables both ordinary and infinite queries without auth or requests", async () => {
  let calls = 0;

  const { utils } = setup(
    async () => {
      calls++;
      return json({});
    },
    () => {
      calls++;
      return "token";
    },
  );

  const cache = new QueryClient();
  const observer = new QueryObserver(cache, utils.getItem.queryOptions({ input: skipToken }));

  const infinite = new InfiniteQueryObserver(
    cache,
    utils.listItems.infiniteOptions({
      input: skipToken,
      initialPageParam: 0,
      getNextPageParam: (page) => page.next,
    }),
  );

  const unsubscribe = observer.subscribe(() => {});
  const unsubscribeInfinite = infinite.subscribe(() => {});
  await cache.invalidateQueries({ queryKey: utils.getItem.key() });
  await cache.invalidateQueries({ queryKey: utils.listItems.key() });
  assert.equal(calls, 0);
  assert.equal(observer.getCurrentResult().fetchStatus, "idle");
  unsubscribe();
  unsubscribeInfinite();
  cache.clear();
});

test("infinite pages use page-specific input with a stable typed cache key", async () => {
  const cursors: string[] = [];

  const { utils } = setup(async (request) => {
    const cursor = new URL(request.url).searchParams.get("cursor")!;
    cursors.push(cursor);
    return json({ next: Number(cursor) + 1 });
  });

  const options = utils.listItems.infiniteOptions({
    input: (cursor: number) => ({ query: { cursor } }),
    initialPageParam: 0,
    getNextPageParam: (page) => page.next,
  });

  const cache = new QueryClient();
  const observer = new InfiniteQueryObserver(cache, options);
  await observer.refetch();
  await observer.fetchNextPage();
  assert.deepEqual(cursors, ["0", "1"]);

  assert.deepEqual(
    options.queryKey,
    utils.listItems.infiniteKey({
      input: (cursor: number) => ({ query: { cursor } }),
      initialPageParam: 0,
    }),
  );

  assert.deepEqual(cache.getQueryData(options.queryKey)?.pageParams, [0, 1]);
  observer.destroy();
  cache.clear();
});

test("mutation retries retain the per-attempt header and grouped input", async () => {
  const keys: (string | null)[] = [];

  const { utils } = setup(async (request) => {
    keys.push(request.headers.get("Idempotency-Key"));

    return keys.length === 1
      ? json({ message: "retry" }, { status: 503 })
      : new Response(null, { status: 204 });
  });

  const cache = new QueryClient();

  const observer = new MutationObserver(
    cache,
    utils.updateItem.mutationOptions({ retry: 1, retryDelay: 0 }),
  );

  await observer.mutate({
    path: { id: "1" },
    body: { name: "Hotel" },
    header: { "Idempotency-Key": "attempt-1" },
  });

  assert.deepEqual(keys, ["attempt-1", "attempt-1"]);
  cache.clear();
});
