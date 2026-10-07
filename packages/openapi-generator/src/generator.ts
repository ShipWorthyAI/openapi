import type { ParsedOpenApi } from "@shipworthy/openapi-parser";
import type { Effect } from "effect";

export interface Generator<A, E = never> {
  readonly id: string;
  generate(
    model: ParsedOpenApi,
    options: Readonly<Record<string, unknown>>,
  ): A | Effect.Effect<A, E>;
}
