import { Schema } from "effect";

/** `x-` keys of a node, as written. */
export const ParsedExtensions = Schema.Record(Schema.String, Schema.Unknown);

export type ParsedExtensions = typeof ParsedExtensions.Type;
