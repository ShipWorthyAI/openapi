import { Flag } from "effect/cli";

export const force = Flag.Boolean("force").pipe(
  Flag.withDescription("Regenerate <name>/types.ts even when its stamp matches."),
  Flag.withDefault(false),
);
