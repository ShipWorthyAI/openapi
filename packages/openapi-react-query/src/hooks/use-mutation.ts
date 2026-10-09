import {
  type QueryClient,
  type UseMutationOptions,
  type UseMutationResult,
  useMutation as useTanstackMutation,
} from "@tanstack/react-query";
import type {
  FetchResponse,
  HttpMethod,
  MaybeOptionalInit,
  MediaType,
  PathsWithMethod,
} from "@shipworthy/openapi-fetch";
import { useApiClient } from "../provider.tsx";
import { parseArgs } from "../utils.ts";

interface ApiClientMutation<Paths extends Record<string, any>> {
  <
    Path extends PathsWithMethod<Paths, "post">,
    Init extends MaybeOptionalInit<Paths[Path], "post">,
    Response extends Required<FetchResponse<Paths[Path]["post"], Init, MediaType>>,
    Options extends Omit<
      UseMutationOptions<Response["data"], Response["error"], Init>,
      "mutationKey" | "mutationFn"
    >,
  >(
    path: Path,
    options?: Options,
    queryClient?: QueryClient,
  ): UseMutationResult<Response["data"], Response["error"], Init>;

  <
    Method extends HttpMethod,
    Path extends PathsWithMethod<Paths, Method>,
    Init extends MaybeOptionalInit<Paths[Path], Method>,
    Response extends Required<
      FetchResponse<Paths[Path][Method] & Record<string | number, any>, Init, MediaType>
    >,
    Options extends Omit<
      UseMutationOptions<Response["data"], Response["error"], Init>,
      "mutationKey" | "mutationFn"
    >,
  >(
    path: Path,
    method: Method,
    options?: Options,
    queryClient?: QueryClient,
  ): UseMutationResult<Response["data"], Response["error"], Init>;
}

export function useApiClientMutation<
  Paths extends Record<string, any> = {},
>(): ApiClientMutation<Paths> {
  return useMutation as ApiClientMutation<Paths>;
}

function useMutation(path: any, ...args: any[]) {
  const client = useApiClient();
  const { method, rest } = parseArgs(args, "post");
  const [options, queryClient] = rest;

  return useTanstackMutation(
    {
      mutationKey: [method, path],
      mutationFn: async (init: any) => {
        const mth = method.toUpperCase() as Uppercase<HttpMethod>;
        const fn = (client as any)[mth];
        const { data, error } = await fn(path, init);
        if (error) throw error;
        return data;
      },
      ...(options ?? undefined),
    },
    queryClient as QueryClient | undefined,
  );
}
