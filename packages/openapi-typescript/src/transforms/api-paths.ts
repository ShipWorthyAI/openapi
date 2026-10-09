import type { ParsedPathItem } from "@shipworthy/openapi-transformer";
import { Effect } from "effect";
import type ts from "#compiler";
import { tsEnum } from "../lib/ts.ts";

/** An enum key for an operation without an `operationId`: the method and path, without parameters. */
function enumName(method: string, url: string): string {
  return (method + url)
    .split("/")
    .map((part) => {
      const capitalised = part.charAt(0).toUpperCase() + part.slice(1);
      // drop characters enum keys can't have, and named parameters
      return capitalised.replace(/{.*}|:.*|[^a-zA-Z\d_]+/, "");
    })
    .join("");
}

/** Transform the paths into an `ApiPaths` enum with one member per operation. */
export function transformApiPaths(
  paths: Readonly<Record<string, ParsedPathItem>>,
): Effect.Effect<ts.EnumDeclaration> {
  return Effect.sync(() => {
    const urls: string[] = [];
    const metadata: { name: string }[] = [];

    for (const [url, item] of Object.entries(paths)) {
      for (const operation of item.operations) {
        urls.push(url);

        metadata.push({
          name: operation.operationId ?? enumName(operation.method.toLowerCase(), url),
        });
      }
    }

    return tsEnum("ApiPaths", urls, metadata, { export: true });
  });
}
