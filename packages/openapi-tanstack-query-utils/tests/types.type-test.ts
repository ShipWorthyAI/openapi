import {
  createApiClient,
  createTanstackQueryUtils,
  type OperationInput,
  type OperationData,
} from "../src/index";
import type { ItemOperation, UpdateOperation, ListOperation } from "./fixtures";
import {
  QueryClient,
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from "@tanstack/react-query";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type Expect<T extends true> = T;

const utils = createTanstackQueryUtils<{
  getItem: ItemOperation;
  updateItem: UpdateOperation;
  listItems: ListOperation;
}>(
  createApiClient({ baseUrl: "http://example.test" }),
  {
    getItem: ["GET", "/items/{id}"],
    updateItem: ["POST", "/items/{id}"],
    listItems: ["GET", "/items"],
  },
  { prefix: "test" },
);

// Compile only; no hooks run during the test process.
export function checkTypes(id: string | undefined) {
  const query = useQuery(
    utils.getItem.queryOptions({
      input: { path: { id: "1" } },
      select: (item) => item.name,
    }),
  );

  type Selected = Expect<Equal<typeof query.data, string | undefined>>;
  const suspense = useSuspenseQuery(utils.getItem.queryOptions({ input: { path: { id: "1" } } }));
  type Suspense = Expect<Equal<typeof suspense.data, { name: string }>>;

  const conditional = utils.getItem.queryOptions({
    input: id ? { path: { id } } : skipToken,
  });

  useQuery(conditional);
  // TanStack 5.59 does not reject skipToken in its suspense types. Our result
  // still exposes it honestly; only ordinary-input overloads guarantee a function.
  // @ts-expect-error Conditional input does not guarantee an executable queryFn.
  const suspenseFn: (...args: any[]) => unknown = conditional.queryFn;
  // @ts-expect-error Required path parameter.
  utils.getItem.queryOptions();
  // @ts-expect-error Input remains required even when enabled is false.
  utils.getItem.queryOptions({ enabled: false });
  // @ts-expect-error Required id is missing.
  utils.getItem.queryOptions({ input: {} });

  utils.getItem.queryOptions({
    // @ts-expect-error Wrong query parameter type.
    input: { path: { id: "1" }, query: { tags: 4 } },
  });

  // @ts-expect-error Operation names are generated, not arbitrary strings.
  utils.unknown.queryOptions();
  utils.listItems.queryOptions();
  utils.updateItem.queryOptions({ input: skipToken });
  utils.getItem.key({ input: { query: { filter: { country: "US" } } } });
  // @ts-expect-error Wrong partial filter.
  utils.getItem.key({ input: { path: { id: 123 } } });

  const mutation = useMutation(
    utils.updateItem.mutationOptions({
      onSuccess: (data) => {
        type Empty = Expect<Equal<typeof data, null>>;
      },
    }),
  );

  mutation.mutate({
    path: { id: "1" },
    body: { name: "Hotel" },
    header: { "Idempotency-Key": "attempt" },
  });

  // @ts-expect-error Headers are required per mutation attempt.
  mutation.mutate({ path: { id: "1" }, body: { name: "Hotel" } });

  mutation.mutate({
    path: { id: "1" },
    // @ts-expect-error The generated body fields are required.
    body: {},
    header: { "Idempotency-Key": "attempt" },
  });

  useMutation(utils.listItems.mutationOptions()).mutate({
    query: { cursor: 2 },
  });

  useMutation(utils.listItems.mutationOptions()).mutate({
    // @ts-expect-error Mutation variables are already the grouped input, not wrapped in input.
    input: { cursor: 2 },
  });

  const infinite = utils.listItems.infiniteOptions({
    input: (cursor: number) => ({ query: { cursor } }),
    initialPageParam: 0,
    getNextPageParam: (page) => page.next,
  });

  useInfiniteQuery(infinite);
  useSuspenseInfiniteQuery(infinite);

  const selected = useInfiniteQuery(
    utils.listItems.infiniteOptions({
      input: (cursor: number) => ({ query: { cursor } }),
      initialPageParam: 0,
      getNextPageParam: (page) => page.next,
      select: (data) => data.pages.length,
    }),
  );

  type InfiniteSelected = Expect<Equal<typeof selected.data, number | undefined>>;

  const skipped = utils.listItems.infiniteOptions({
    input: id ? (cursor: number) => ({ query: { cursor } }) : skipToken,
    initialPageParam: 0,
    getNextPageParam: (page) => page.next,
  });

  useInfiniteQuery(skipped);
  // @ts-expect-error Conditional pagination does not guarantee an executable queryFn.
  const infiniteFn: (...args: any[]) => unknown = skipped.queryFn;

  utils.listItems.infiniteOptions({
    // @ts-expect-error Wrong page input type.
    input: (cursor: number) => ({ query: { cursor: String(cursor) } }),
    initialPageParam: 0,
    getNextPageParam: (page) => page.next,
  });

  const cache = new QueryClient();
  const key = utils.getItem.queryKey({ input: { path: { id: "1" } } });
  const cached = cache.getQueryData(key);
  type Cached = Expect<Equal<typeof cached, { name: string } | undefined>>;
  cache.setQueryData(key, (old) => (old ? { name: old.name.toUpperCase() } : undefined));
  // @ts-expect-error A typed key rejects invalid cache data.
  cache.setQueryData(key, { name: 123 });
  const pages = cache.getQueryData(infinite.queryKey);
  type Pages = Expect<Equal<NonNullable<typeof pages>["pageParams"], number[]>>;
}

type Input = OperationInput<{
  parameters: { path: { id: string }; query: { id: boolean } };
  requestBody: { content: { "application/json": { id: number } } };
  responses: {};
}>;

type PathId = Expect<Equal<Input["path"]["id"], string>>;
type QueryId = Expect<Equal<Input["query"]["id"], boolean>>;
type BodyId = Expect<Equal<Input["body"]["id"], number>>;

const valid: Input = {
  path: { id: "1" },
  query: { id: true },
  body: { id: 1 },
};

// @ts-expect-error Required bodies remain required.
const invalid: Input = { path: { id: "1" }, query: { id: true } };

type OptionalBody = OperationInput<{
  parameters: { path: { id: string } };
  requestBody?: { content: { "application/json": { title: string } } };
  responses: {};
}>;

const optionalBody: OptionalBody = { path: { id: "1" } };

type Created = OperationData<{
  responses: { 201: { content: { "application/json": { id: string } } } };
}>;

type Accepted = OperationData<{
  responses: { 202: { content: { "application/json": { pending: boolean } } } };
}>;

type CreatedResponse = Expect<Equal<Created, { id: string }>>;
type AcceptedResponse = Expect<Equal<Accepted, { pending: boolean }>>;
