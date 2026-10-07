import { Schema } from "effect";
import { node, shareable } from "./fields.js";
import { optionalString } from "./optional.js";
import { ParsedOperation } from "./operation.js";
import { ParsedParameter } from "./parameter.js";
import { ParsedServer } from "./server.js";

/**
 * A path item: the operations under one URL template, webhook, callback expression, or
 * `components.pathItems` entry. Stoplight flattens these away; generators that print per-path
 * types need the path-level parameters and `reference`.
 */
export const ParsedPathItem = Schema.Struct({
  ...node,
  ...shareable,
  summary: optionalString,
  description: optionalString,
  /** Path-level parameters only, in declaration order. */
  parameters: Schema.Array(ParsedParameter),
  /** In `get`, `put`, `post`, `delete`, `options`, `head`, `patch`, `trace` order. */
  operations: Schema.Array(ParsedOperation),
  servers: Schema.Array(ParsedServer),
});

export type ParsedPathItem = typeof ParsedPathItem.Type;
