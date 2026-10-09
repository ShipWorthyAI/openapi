import type { ParsedExtensions } from "../../model/index.ts";

export function readExtensions(value: object): ParsedExtensions {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key.startsWith("x-")));
}
