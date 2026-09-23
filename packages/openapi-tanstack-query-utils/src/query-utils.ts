import type { OperationInput, OperationData, OperationError } from "./operation";
import {
  skipToken,
  type DataTag,
  type InfiniteData,
  type QueryFunction,
  type QueryKey,
  type SkipToken,
  type UseInfiniteQueryOptions,
  type UseMutationOptions,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { Client } from "@shipworthy/openapi-fetch";
import type { HttpMethod } from "@shipworthy/openapi-typescript-helpers";
import type { RequiredKeysOf } from "@shipworthy/openapi-typescript-helpers";

type InputOf<O> = OperationInput<O>;
type DataOf<O> = OperationData<O>;
type ErrorOf<O> = OperationError<O>;
type Field<K extends string, T> =
  RequiredKeysOf<T> extends never ? { [P in K]?: T } : { [P in K]: T };
type Request<O> = Field<"input", InputOf<O>>;
type Args<T> = RequiredKeysOf<T> extends never ? [options?: T] : [options: T];
type Variables<O> = InputOf<O>;
type PartialInput<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: PartialInput<T[K]> }
    : T;
type Key<Data> = DataTag<QueryKey, Data>;
type QueryConfig<O, Selected> = Omit<
  UseQueryOptions<DataOf<O>, ErrorOf<O>, Selected, Key<DataOf<O>>>,
  "queryKey" | "queryFn"
>;
type QueryResult<O, Selected, Fn> = QueryConfig<O, Selected> & {
  queryKey: Key<DataOf<O>>;
  queryFn: Fn;
};
type InfiniteConfig<O, Page, Selected> = Omit<
  UseInfiniteQueryOptions<
    DataOf<O>,
    ErrorOf<O>,
    Selected,
    Key<InfiniteData<DataOf<O>, Page>>,
    Page
  >,
  "queryKey" | "queryFn"
>;
type InfiniteResult<O, Page, Selected, Fn> = InfiniteConfig<O, Page, Selected> & {
  queryKey: Key<InfiniteData<DataOf<O>, Page>>;
  queryFn: Fn;
};
type InfiniteInput<O, Page> = {
  input: (pageParam: Page) => InputOf<O>;
  initialPageParam: Page;
};

export interface OperationQueryUtils<O> {
  key(options?: {
    type?: "query" | "infinite" | "mutation";
    input?: PartialInput<InputOf<O>>;
  }): QueryKey;
  queryKey(...args: Args<Request<O>>): Key<DataOf<O>>;
  queryOptions<Selected = DataOf<O>>(
    ...args: Args<Request<O> & QueryConfig<O, Selected>>
  ): QueryResult<O, Selected, QueryFunction<DataOf<O>, Key<DataOf<O>>>>;
  queryOptions<Selected = DataOf<O>>(
    options: Omit<Request<O>, "input"> & {
      input: InputOf<O> | SkipToken;
    } & QueryConfig<O, Selected>,
  ): QueryResult<O, Selected, QueryFunction<DataOf<O>, Key<DataOf<O>>> | SkipToken>;
  infiniteKey<Page>(options: InfiniteInput<O, Page>): Key<InfiniteData<DataOf<O>, Page>>;
  infiniteOptions<Page, Selected = InfiniteData<DataOf<O>, Page>>(
    options: InfiniteInput<O, Page> & InfiniteConfig<O, Page, Selected>,
  ): InfiniteResult<
    O,
    Page,
    Selected,
    QueryFunction<DataOf<O>, Key<InfiniteData<DataOf<O>, Page>>, Page>
  >;
  infiniteOptions<Page, Selected = InfiniteData<DataOf<O>, Page>>(
    options: Omit<InfiniteInput<O, Page>, "input"> & {
      input: ((pageParam: Page) => InputOf<O>) | SkipToken;
    } & InfiniteConfig<O, Page, Selected>,
  ): InfiniteResult<
    O,
    Page,
    Selected,
    QueryFunction<DataOf<O>, Key<InfiniteData<DataOf<O>, Page>>, Page> | SkipToken
  >;
  mutationKey(): QueryKey;
  mutationOptions<Context = unknown>(
    options?: Omit<
      UseMutationOptions<DataOf<O>, ErrorOf<O>, Variables<O>, Context>,
      "mutationKey" | "mutationFn"
    >,
  ): UseMutationOptions<DataOf<O>, ErrorOf<O>, Variables<O>, Context> & {
    mutationKey: QueryKey;
    mutationFn: (variables: Variables<O>) => Promise<DataOf<O>>;
  };
}

export interface TanstackQueryUtilsOptions {
  prefix: string | readonly string[];
}

export type OperationRoute = readonly [Uppercase<HttpMethod>, string];

function cacheInput(input: Record<string, unknown> = {}) {
  const { header, ...rest } = input;
  if (!header) return rest;
  const entries = Object.entries(header).filter(
    ([name, value]) =>
      value !== undefined &&
      !["authorization", "proxy-authorization", "cookie", "set-cookie"].includes(
        name.toLowerCase(),
      ),
  );
  return entries.length
    ? {
        ...rest,
        header: Object.fromEntries(entries.map(([name, value]) => [name.toLowerCase(), value])),
      }
    : rest;
}

export function createTanstackQueryUtils<Operations extends Record<string, any>>(
  client: Client<any>,
  routes: { [Name in keyof Operations]: OperationRoute },
  { prefix }: TanstackQueryUtilsOptions,
): { [Name in keyof Operations]: OperationQueryUtils<Operations[Name]> } {
  const namespace = typeof prefix === "string" ? [prefix] : [...prefix];
  return Object.fromEntries(
    Object.entries(routes).map(([name, [method, path]]) => {
      const request = async (input: Record<string, unknown> = {}, signal?: AbortSignal) => {
        const { body, ...params } = input;
        const { data, error, response } = await client[method](path, {
          params,
          body,
          signal,
        });
        if (!response.ok)
          throw error ?? new Error(`HTTP ${response.status} ${response.statusText}`);
        return data ?? null;
      };
      const key = (options: any = {}) => {
        const { input, ...filter } = options;
        if (input !== undefined) filter.input = cacheInput(input);
        return Object.keys(filter).length ? [...namespace, name, filter] : [...namespace, name];
      };
      const queryKey = ({ input }: any = {}) => key({ type: "query", input: input ?? {} });
      const infiniteKey = ({ input, initialPageParam }: any) =>
        key({ type: "infinite", input: input(initialPageParam) });
      const mutationKey = () => key({ type: "mutation" });
      return [
        name,
        {
          key,
          queryKey,
          infiniteKey,
          mutationKey,
          queryOptions({ input, ...options }: any = {}) {
            return {
              ...options,
              queryKey:
                input === skipToken ? key({ type: "query", skipped: true }) : queryKey({ input }),
              queryFn:
                input === skipToken
                  ? skipToken
                  : ({ signal }: { signal: AbortSignal }) => request(input, signal),
            };
          },
          infiniteOptions({ input, ...options }: any) {
            return {
              ...options,
              queryKey:
                input === skipToken
                  ? key({ type: "infinite", skipped: true })
                  : infiniteKey({
                      input,
                      initialPageParam: options.initialPageParam,
                    }),
              queryFn:
                input === skipToken
                  ? skipToken
                  : ({ pageParam, signal }: { pageParam: unknown; signal: AbortSignal }) =>
                      request(input(pageParam), signal),
            };
          },
          mutationOptions(options: any = {}) {
            return {
              ...options,
              mutationKey: mutationKey(),
              mutationFn: (input: Record<string, unknown>) => request(input),
            };
          },
        },
      ];
    }),
  ) as unknown as {
    [Name in keyof Operations]: OperationQueryUtils<Operations[Name]>;
  };
}
