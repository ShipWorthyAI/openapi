import {
  type QueryClient,
  type UseSuspenseQueryOptions,
  type UseSuspenseQueryResult,
  useSuspenseQuery as useTanstackSuspenseQuery,
} from "@tanstack/react-query";
import type {
  FetchResponse,
  HttpMethod,
  MaybeOptionalInit,
  MediaType,
  PathsWithMethod,
  RequiredKeysOf,
} from "@shipworthy/openapi-fetch";
import { useApiClient } from "../provider";
import {
  type InferSelectReturnType,
  type InitWithUnknowns,
  type QueryKey,
  buildQueryFn,
  buildQueryKey,
  parseArgs,
} from "../utils";

interface ApiClientSuspenseQuery<Paths extends Record<string, any>> {
  <
    Path extends PathsWithMethod<Paths, "get">,
    Init extends MaybeOptionalInit<Paths[Path], "get">,
    Response extends Required<FetchResponse<Paths[Path]["get"], Init, MediaType>>,
    Options extends Omit<
      UseSuspenseQueryOptions<
        Response["data"],
        Response["error"],
        InferSelectReturnType<Response["data"], Options["select"]>,
        QueryKey<Paths, "get", Path>
      >,
      "queryKey" | "queryFn"
    >,
  >(
    path: Path,
    ...[init, options, queryClient]: RequiredKeysOf<Init> extends never
      ? [InitWithUnknowns<Init>?, Options?, QueryClient?]
      : [InitWithUnknowns<Init>, Options?, QueryClient?]
  ): UseSuspenseQueryResult<
    InferSelectReturnType<Response["data"], Options["select"]>,
    Response["error"]
  >;

  /** Explicit method overload */
  <
    Method extends HttpMethod,
    Path extends PathsWithMethod<Paths, Method>,
    Init extends MaybeOptionalInit<Paths[Path], Method>,
    Response extends Required<
      FetchResponse<Paths[Path][Method] & Record<string | number, any>, Init, MediaType>
    >,
    Options extends Omit<
      UseSuspenseQueryOptions<
        Response["data"],
        Response["error"],
        InferSelectReturnType<Response["data"], Options["select"]>,
        QueryKey<Paths, Method, Path>
      >,
      "queryKey" | "queryFn"
    >,
  >(
    path: Path,
    method: Method,
    ...[init, options, queryClient]: RequiredKeysOf<Init> extends never
      ? [InitWithUnknowns<Init>?, Options?, QueryClient?]
      : [InitWithUnknowns<Init>, Options?, QueryClient?]
  ): UseSuspenseQueryResult<
    InferSelectReturnType<Response["data"], Options["select"]>,
    Response["error"]
  >;
}

export function useApiClientSuspenseQuery<
  Paths extends Record<string, any> = {},
>(): ApiClientSuspenseQuery<Paths> {
  return useSuspenseQuery as ApiClientSuspenseQuery<Paths>;
}

function useSuspenseQuery(path: any, ...args: any[]) {
  const client = useApiClient();
  const { method, rest } = parseArgs(args, "get");
  const [init, options, queryClient] = rest;

  return useTanstackSuspenseQuery(
    {
      queryKey: buildQueryKey(method, path, init),
      queryFn: buildQueryFn(client, method, path, init),
      ...(options ?? undefined),
    },
    queryClient as QueryClient | undefined,
  );
}
