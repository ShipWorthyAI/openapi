import type { Client, MaybeOptionalInit } from "@shipworthy/openapi-fetch";
import type { HttpMethod, PathsWithMethod } from "@shipworthy/openapi-typescript-helpers";

export type InferSelectReturnType<TData, TSelect> = TSelect extends (data: TData) => infer R
  ? R
  : TData;

export type InitWithUnknowns<Init> = Init & { [key: string]: unknown };

export type QueryKey<
  Paths extends Record<string, any>,
  Method extends HttpMethod,
  Path extends PathsWithMethod<Paths, Method>,
  Init = MaybeOptionalInit<Paths[Path], Method>,
> = Init extends undefined ? readonly [Method, Path] : readonly [Method, Path, Init];

export function parseArgs(args: unknown[], defaultMethod: HttpMethod) {
  if (typeof args[0] === "string") {
    const [method, ...rest] = args;
    return { method: method as HttpMethod, rest };
  }

  return { method: defaultMethod, rest: args };
}

export function buildQueryFn(client: Client<{}>, method: HttpMethod, path: string, init: unknown) {
  return async ({ signal }: { signal: AbortSignal }) => {
    const mth = method.toUpperCase() as Uppercase<HttpMethod>;
    const fn = (client as any)[mth];

    const { data, error, response } = await fn(path, {
      signal,
      ...(init ?? undefined),
    });

    if (error) throw error;

    if (response.status === 204 || response.headers.get("Content-Length") === "0") {
      return data ?? null;
    }

    return data;
  };
}

export function buildQueryKey(method: HttpMethod, path: string, init: unknown) {
  return init === undefined ? ([method, path] as const) : ([method, path, init] as const);
}
