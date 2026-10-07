import { Schema } from "effect";
import { ParsedExtensions } from "./extensions.js";
import { optionalField } from "./optional.js";
import { ParsedRef } from "./reference.js";

/** Fields of a node with a location in the bundled document. */
export const node = {
  id: Schema.String,
  extensions: ParsedExtensions,
};

/**
 * Fields of a node that may have been reached through a `$ref`. `reference` is the Reference
 * Object it was resolved from; its `summary` and `description` override the target's, as
 * OpenAPI 3.1 allows.
 */
export const shareable = {
  reference: optionalField(ParsedRef),
};
