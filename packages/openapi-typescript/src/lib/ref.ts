/** JSON Pointer helpers used while turning OpenAPI paths into type indexes. */
import { Array as Arr, Option, pipe, String as Str } from "effect";

export function escapePointer(token: string): string {
  return pipe(token, Str.replaceAll("~", "~0"), Str.replaceAll("/", "~1"));
}

export function unescapePointer(token: string): string {
  return pipe(token, Str.replaceAll("~1", "/"), Str.replaceAll("~0", "~"));
}

/** Split a `$ref` into its URI and decoded JSON Pointer segments. */
export function parseRef(ref: string): { uri: string; pointer: string[] } {
  const hash = pipe(ref, Str.indexOf("#"));

  if (Option.isNone(hash)) {
    return { uri: ref, pointer: [] };
  }

  const uri = pipe(ref, Str.slice(0, hash.value));
  const fragment = pipe(ref, Str.slice(hash.value + 1));

  if (!fragment) {
    return { uri, pointer: [] };
  }

  if (!pipe(fragment, Str.startsWith("/"))) {
    return { uri, pointer: [unescapePointer(fragment)] };
  }

  return {
    uri,
    pointer: pipe(
      fragment,
      Str.split("/"),
      Arr.drop(1),
      Arr.map((part) => unescapePointer(part)),
    ),
  };
}
