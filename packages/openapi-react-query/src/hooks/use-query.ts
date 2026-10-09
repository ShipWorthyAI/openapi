import {
  type QueryClient,
  type SkipToken,
  type UseQueryOptions,
  type UseQueryResult,
  useQuery as useTanstackQuery,
} from "@tanstack/react-query";
import type {
  FetchResponse,
  HttpMethod,
  MaybeOptionalInit,
  MediaType,
  PathsWithMethod,
  RequiredKeysOf,
} from "@shipworthy/openapi-fetch";
import { useApiClient } from "../provider.js";
import {
  type InferSelectReturnType,
  type InitWithUnknowns,
  type QueryKey,
  buildQueryFn,
  buildQueryKey,
  parseArgs,
} from "../utils.js";

interface ApiClientQueryOptions<Paths extends Record<string, any>> {
  <
    Path extends PathsWithMethod<Paths, "get">,
    Init extends MaybeOptionalInit<Paths[Path], "get">,
    Response extends Required<FetchResponse<Paths[Path]["get"], Init, MediaType>>,
    Options extends Omit<
      UseQueryOptions<
        Response["data"],
        Response["error"],
        InferSelectReturnType<Response["data"], Options["select"]>,
        QueryKey<Paths, "get", Path>
      >,
      "queryKey" | "queryFn"
    >,
  >(
    path: Path,
    ...[init, options]: RequiredKeysOf<Init> extends never
      ? [InitWithUnknowns<Init>?, Options?]
      : [InitWithUnknowns<Init>, Options?]
  ): NoInfer<
    Omit<
      UseQueryOptions<
        Response["data"],
        Response["error"],
        InferSelectReturnType<Response["data"], Options["select"]>,
        QueryKey<Paths, "get", Path>
      >,
      "queryFn"
    > & {
      queryFn: Exclude<
        UseQueryOptions<
          Response["data"],
          Response["error"],
          InferSelectReturnType<Response["data"], Options["select"]>,
          QueryKey<Paths, "get", Path>
        >["queryFn"],
        SkipToken | undefined
      >;
    }
  >;

  <
    Method extends HttpMethod,
    Path extends PathsWithMethod<Paths, Method>,
    Init extends MaybeOptionalInit<Paths[Path], Method>,
    Response extends Required<
      FetchResponse<Paths[Path][Method] & Record<string | number, any>, Init, MediaType>
    >,
    Options extends Omit<
      UseQueryOptions<
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
    ...[init, options]: RequiredKeysOf<Init> extends never
      ? [InitWithUnknowns<Init>?, Options?]
      : [InitWithUnknowns<Init>, Options?]
  ): NoInfer<
    Omit<
      UseQueryOptions<
        Response["data"],
        Response["error"],
        InferSelectReturnType<Response["data"], Options["select"]>,
        QueryKey<Paths, Method, Path>
      >,
      "queryFn"
    > & {
      queryFn: Exclude<
        UseQueryOptions<
          Response["data"],
          Response["error"],
          InferSelectReturnType<Response["data"], Options["select"]>,
          QueryKey<Paths, Method, Path>
        >["queryFn"],
        SkipToken | undefined
      >;
    }
  >;
}

interface ApiClientQuery<Paths extends Record<string, any>> {
  <
    Path extends PathsWithMethod<Paths, "get">,
    Init extends MaybeOptionalInit<Paths[Path], "get">,
    Response extends Required<FetchResponse<Paths[Path]["get"], Init, MediaType>>,
    Options extends Omit<
      UseQueryOptions<
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
  ): UseQueryResult<InferSelectReturnType<Response["data"], Options["select"]>, Response["error"]>;

  <
    Method extends HttpMethod,
    Path extends PathsWithMethod<Paths, Method>,
    Init extends MaybeOptionalInit<Paths[Path], Method>,
    Response extends Required<
      FetchResponse<Paths[Path][Method] & Record<string | number, any>, Init, MediaType>
    >,
    Options extends Omit<
      UseQueryOptions<
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
  ): UseQueryResult<InferSelectReturnType<Response["data"], Options["select"]>, Response["error"]>;
}

/** Bind a schema first, then call the returned hook to infer each endpoint. */
export function useApiClientQuery<Paths extends Record<string, any> = {}>(): ApiClientQuery<Paths> {
  return useQuery as ApiClientQuery<Paths>;
}

/** Bind a schema first, then call the returned hook to build query options. */
export function useApiClientQueryOptions<
  Paths extends Record<string, any> = {},
>(): ApiClientQueryOptions<Paths> {
  return useQueryOptions as ApiClientQueryOptions<Paths>;
}

function useQueryOptions(path: any, ...args: any[]): any {
  const client = useApiClient();
  const { method, rest } = parseArgs(args, "get");
  const [init, options] = rest;

  return {
    queryKey: buildQueryKey(method, path, init),
    queryFn: buildQueryFn(client, method, path, init),
    ...(options ?? undefined),
  };
}

function useQuery(path: any, ...args: any[]) {
  const client = useApiClient();
  const { method, rest } = parseArgs(args, "get");
  const [init, options, queryClient] = rest;

  return useTanstackQuery(
    {
      queryKey: buildQueryKey(method, path, init),
      queryFn: buildQueryFn(client, method, path, init),
      ...(options ?? undefined),
    },
    queryClient as QueryClient | undefined,
  );
}
