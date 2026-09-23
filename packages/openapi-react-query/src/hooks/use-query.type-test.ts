import {
  useApiClient,
  useApiClientQuery,
  useApiClientQueryOptions,
  useApiClientSuspenseQuery,
  useApiClientInfiniteQuery,
  useApiClientMutation,
  type QueryKey,
} from "../react/index";
import { useQuery as useTanstackQuery } from "@tanstack/react-query";

type Responses<Data> = {
  200: { content: { "application/json": Data } };
  400: { content: { "application/json": { message: string } } };
};

interface TestPaths {
  "/items": {
    get: {
      parameters: { query?: { limit?: number } };
      responses: Responses<{ items: string[] }>;
    };
    post: {
      requestBody: { content: { "application/json": { name: string } } };
      responses: Responses<{ id: number }>;
    };
  };
  "/items/{id}": {
    get: {
      parameters: { path: { id: number }; query: { locale: string } };
      responses: Responses<{ name: string }>;
    };
  };
  "/create": { post: TestPaths["/items"]["post"]; get?: never };
}

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
function expectType<T extends true>() {}

// This function is never run. The package typecheck checks every assertion,
// including that each @ts-expect-error continues to reject invalid input.
function useQueryTypeTests() {
  const useQuery = useApiClientQuery<TestPaths>();
  const useQueryOptions = useApiClientQueryOptions<TestPaths>();

  const list = useQuery("/items");
  expectType<Equal<typeof list.data, { items: string[] } | undefined>>();
  expectType<Equal<typeof list.error, { message: string } | null>>();
  useQuery("/items", { params: { query: { limit: 5 } } });
  const detail = useQuery("/items/{id}", {
    params: { path: { id: 1 }, query: { locale: "en" } },
  });
  expectType<Equal<typeof detail.data, { name: string } | undefined>>();

  const created = useQuery("/items", "post", { body: { name: "Item" } });
  expectType<Equal<typeof created.data, { id: number } | undefined>>();
  expectType<Equal<typeof created.error, { message: string } | null>>();

  const selected = useQuery("/items", undefined, {
    select: (data) => {
      expectType<Equal<typeof data, { items: string[] }>>();
      return data.items.length;
    },
  });
  expectType<Equal<typeof selected.data, number | undefined>>();
  const selectedPost = useQuery(
    "/items",
    "post",
    { body: { name: "Item" } },
    {
      select: (data) => data.id.toString(),
    },
  );
  expectType<Equal<typeof selectedPost.data, string | undefined>>();

  const text = useQuery("/items", { parseAs: "text" });
  expectType<Equal<typeof text.data, string | undefined>>();
  const options = useQueryOptions("/items", undefined, {
    select: (data) => data.items.length,
  });
  const fromOptions = useTanstackQuery(options);
  expectType<Equal<typeof fromOptions.data, number | undefined>>();
  expectType<Equal<(typeof options.queryKey)[0], "get">>();
  expectType<Equal<(typeof options.queryKey)[1], "/items">>();
  const postOptions = useQueryOptions("/items", "post", {
    body: { name: "Item" },
  });
  const fromPostOptions = useTanstackQuery(postOptions);
  expectType<Equal<typeof fromPostOptions.data, { id: number } | undefined>>();

  // @ts-expect-error Unknown endpoint.
  useQuery("/missing");
  // @ts-expect-error Methods must exist on the selected endpoint.
  useQuery("/items", "delete");
  // @ts-expect-error The default GET method is unavailable.
  useQuery("/create");
  // @ts-expect-error Required parameters cannot be omitted.
  useQuery("/items/{id}");
  // @ts-expect-error Required query parameters cannot be omitted.
  useQuery("/items/{id}", { params: { path: { id: 1 } } });
  // @ts-expect-error Path parameter types must match the schema.
  useQuery("/items/{id}", {
    params: { path: { id: "1" }, query: { locale: "en" } },
  });
  // @ts-expect-error Query parameter types must match the schema.
  useQuery("/items", { params: { query: { limit: "5" } } });
  // @ts-expect-error A POST body is required.
  useQuery("/items", "post");
  // @ts-expect-error The body must match the selected operation.
  useQuery("/items", "post", { body: { name: 123 } });
  // @ts-expect-error The response is specific to this endpoint.
  list.data?.name;
  // @ts-expect-error Explicit method responses must not become any.
  created.data?.items;
  // @ts-expect-error The callback receives the selected endpoint's response.
  useQuery("/items", undefined, { select: (data) => data.name });
  // @ts-expect-error Options hooks also enforce required parameters.
  useQueryOptions("/items/{id}");
  // @ts-expect-error Options hooks reject unsupported methods.
  useQueryOptions("/items", "delete");

  const useUnboundQuery = useApiClientQuery();
  // @ts-expect-error Omitting the schema must not produce an untyped hook.
  useUnboundQuery("/items");
  // @ts-expect-error A schema must be bound before passing an endpoint.
  useApiClientQuery("/items");
  // @ts-expect-error Only endpoints in the chosen schema are accepted.
  useQuery("/other-api");

  const key: QueryKey<TestPaths, "get", "/items/{id}"> = [
    "get",
    "/items/{id}",
    { params: { path: { id: 1 }, query: { locale: "en" } } },
  ];
  expectType<Equal<(typeof key)[2]["params"]["path"]["id"], number>>();

  const useSuspenseQuery = useApiClientSuspenseQuery<TestPaths>();
  const suspense = useSuspenseQuery("/items");
  expectType<Equal<typeof suspense.data, { items: string[] }>>();
  const suspensePost = useSuspenseQuery("/items", "post", {
    body: { name: "Item" },
  });
  expectType<Equal<typeof suspensePost.data, { id: number }>>();
  const suspenseSelected = useSuspenseQuery("/items", undefined, {
    select: (data) => data.items.length,
  });
  expectType<Equal<typeof suspenseSelected.data, number>>();
  // @ts-expect-error Suspense queries enforce required parameters.
  useSuspenseQuery("/items/{id}");
  // @ts-expect-error Suspense queries reject unsupported methods.
  useSuspenseQuery("/items", "delete");

  const useInfiniteQuery = useApiClientInfiniteQuery<TestPaths>();
  const infinite = useInfiniteQuery(
    "/items",
    {},
    {
      initialPageParam: 0,
      getNextPageParam: (page) => {
        expectType<Equal<typeof page, { items: string[] }>>();
        return undefined;
      },
    },
  );
  expectType<Equal<NonNullable<typeof infinite.data>["pages"][number], { items: string[] }>>();
  const infinitePost = useInfiniteQuery(
    "/items",
    "post",
    { body: { name: "Item" } },
    {
      initialPageParam: 0,
      getNextPageParam: () => undefined,
      select: (data) => data.pages.map((page) => page.id),
    },
  );
  expectType<Equal<typeof infinitePost.data, number[] | undefined>>();
  useInfiniteQuery(
    "/items/{id}",
    // @ts-expect-error Infinite queries enforce required parameters.
    {},
    { initialPageParam: 0, getNextPageParam: () => undefined },
  );
  useInfiniteQuery(
    // @ts-expect-error Infinite queries reject unknown endpoints.
    "/missing",
    {},
    { initialPageParam: 0, getNextPageParam: () => undefined },
  );

  const useMutation = useApiClientMutation<TestPaths>();
  const mutation = useMutation("/items");
  expectType<Equal<typeof mutation.data, { id: number } | undefined>>();
  expectType<Equal<typeof mutation.error, { message: string } | null>>();
  mutation.mutate({ body: { name: "Item" } });
  // @ts-expect-error Mutation bodies must match the schema.
  mutation.mutate({ body: { name: 123 } });
  // @ts-expect-error Mutation bodies cannot be omitted.
  mutation.mutate({});
  const getMutation = useMutation("/items/{id}", "get");
  expectType<Equal<typeof getMutation.data, { name: string } | undefined>>();
  // @ts-expect-error Explicit mutation methods also enforce required parameters.
  getMutation.mutate({});
  // @ts-expect-error Mutations reject unsupported methods.
  useMutation("/items", "delete");

  const client = useApiClient<TestPaths>();
  const response = client.GET("/items");
  expectType<Equal<Awaited<typeof response>["data"], { items: string[] } | undefined>>();
  // @ts-expect-error The raw client is also restricted to the chosen schema.
  client.GET("/missing");
  // @ts-expect-error The raw client enforces required parameters.
  client.GET("/items/{id}");
  const unboundClient = useApiClient();
  // @ts-expect-error Omitting a schema must not silently allow arbitrary requests.
  unboundClient.GET("/items");
}
