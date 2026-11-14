import type { ParsedPathItem } from "@shipworthy/openapi-transformer";
import { Array as Arr, Effect, pipe, Record, String as Str } from "effect";
import type ts from "#compiler";
import { tsEnum } from "../lib/ts.ts";

/** An enum key for an operation without an `operationId`: the method and path, without parameters. */
function enumName(method: string, url: string): string {
  return pipe(
    method + url,
    Str.split("/"),
    Arr.map((part) =>
      // drop characters enum keys can't have, and named parameters
      pipe(part, Str.capitalize, Str.replace(/{.*}|:.*|[^a-zA-Z\d_]+/, "")),
    ),
    Arr.join(""),
  );
}

/** Transform the paths into an `ApiPaths` enum with one member per operation. */
export function transformApiPaths(
  paths: Readonly<Record<string, ParsedPathItem>>,
): Effect.Effect<ts.EnumDeclaration> {
  return Effect.sync(() => {
    const urls: string[] = [];
    const metadata: { name: string }[] = [];

    for (const [url, item] of Record.toEntries(paths)) {
      for (const operation of item.operations) {
        urls.push(url);

        metadata.push({
          name: operation.operationId ?? enumName(Str.toLowerCase(operation.method), url),
        });
      }
    }

    return tsEnum("ApiPaths", urls, metadata, { export: true });
  });
}
