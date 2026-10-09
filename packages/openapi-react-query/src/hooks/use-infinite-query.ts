import {
  type InfiniteData,
  type QueryClient,
  type UseInfiniteQueryOptions,
  type UseInfiniteQueryResult,
  useInfiniteQuery as useTanstackInfiniteQuery,
} from "@tanstack/react-query";
import type {
  FetchResponse,
  HttpMethod,
  MaybeOptionalInit,
  MediaType,
  PathsWithMethod,
} from "@shipworthy/openapi-fetch";
import { useApiClient } from "../provider";
import {
  type InferSelectReturnType,
  type InitWithUnknowns,
  type QueryKey,
  buildQueryKey,
  parseArgs,
} from "../utils";

interface ApiClientInfiniteQuery<Paths extends Record<string, any>> {
  <
    Path extends PathsWithMethod<Paths, "get">,
    Init extends MaybeOptionalInit<Paths[Path], "get">,
    Response extends Required<FetchResponse<Paths[Path]["get"], Init, MediaType>>,
    Options extends Omit<
      UseInfiniteQueryOptions<
        Response["data"],
        Response["error"],
        InferSelectReturnType<InfiniteData<Response["data"]>, Options["select"]>,
        QueryKey<Paths, "get", Path>,
        unknown
      >,
      "queryKey" | "queryFn"
    > & { pageParamName?: string },
  >(
    path: Path,
    init: InitWithUnknowns<Init>,
    options: Options,
    queryClient?: QueryClient,
  ): UseInfiniteQueryResult<
    InferSelectReturnType<InfiniteData<Response["data"]>, Options["select"]>,
    Response["error"]
  >;

  <
    Method extends HttpMethod,
    Path extends PathsWithMethod<Paths, Method>,
    Init extends MaybeOptionalInit<Paths[Path], Method>,
    Response extends Required<
      FetchResponse<Paths[Path][Method] & Record<string | number, any>, Init, MediaType>
    >,
    Options extends Omit<
      UseInfiniteQueryOptions<
        Response["data"],
        Response["error"],
        InferSelectReturnType<InfiniteData<Response["data"]>, Options["select"]>,
        QueryKey<Paths, Method, Path>,
        unknown
      >,
      "queryKey" | "queryFn"
    > & { pageParamName?: string },
  >(
    path: Path,
    method: Method,
    init: InitWithUnknowns<Init>,
    options: Options,
    queryClient?: QueryClient,
  ): UseInfiniteQueryResult<
    InferSelectReturnType<InfiniteData<Response["data"]>, Options["select"]>,
    Response["error"]
  >;
}

export function useApiClientInfiniteQuery<
  Paths extends Record<string, any> = {},
>(): ApiClientInfiniteQuery<Paths> {
  return useInfiniteQuery as ApiClientInfiniteQuery<Paths>;
}

function useInfiniteQuery(path: any, ...args: any[]) {
  const client = useApiClient();
  const { method, rest } = parseArgs(args, "get");
  const [init, options, queryClient] = rest;

  const { pageParamName = "cursor", ...restOptions } = options as any;
  const queryKey = buildQueryKey(method, path, init);

  return useTanstackInfiniteQuery(
    {
      queryKey,
      queryFn: async ({ pageParam = 0, signal }: { pageParam?: unknown; signal: AbortSignal }) => {
        const mth = method.toUpperCase() as Uppercase<HttpMethod>;
        const fn = (client as any)[mth];

        const mergedInit = {
          ...(init as any),
          signal,
          params: {
            ...((init as any)?.params ?? undefined),
            query: {
              ...((init as any)?.params?.query ?? undefined),
              [pageParamName]: pageParam,
            },
          },
        };

        const { data, error } = await fn(path, mergedInit);
        if (error) throw error;
        return data;
      },
      ...restOptions,
    },
    queryClient as QueryClient | undefined,
  );
}
