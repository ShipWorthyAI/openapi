import type { ParsedService } from "@shipworthy/openapi-transformer";
import type { Effect } from "effect";

export interface Generator<A, E = never> {
  readonly id: string;
  generate(
    model: ParsedService,
    options: Readonly<Record<string, unknown>>,
  ): A | Effect.Effect<A, E>;
}
