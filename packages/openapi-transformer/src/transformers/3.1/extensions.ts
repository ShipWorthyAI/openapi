import { Record, String } from "effect";
import type { ParsedExtensions } from "../../model/index.ts";

export function readExtensions(value: Readonly<Record<string, unknown>>): ParsedExtensions {
  return Record.filter(value, (_, key) => String.startsWith("x-")(key));
}
