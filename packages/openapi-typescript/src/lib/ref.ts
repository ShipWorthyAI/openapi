/** JSON Pointer helpers used while turning OpenAPI paths into type indexes. */

export function escapePointer(token: string): string {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function unescapePointer(token: string): string {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

/** Split a `$ref` into its URI and decoded JSON Pointer segments. */
export function parseRef(ref: string): { uri: string; pointer: string[] } {
  const hash = ref.indexOf("#");
  if (hash === -1) {
    return { uri: ref, pointer: [] };
  }
  const uri = ref.slice(0, hash);
  const fragment = ref.slice(hash + 1);
  if (!fragment) {
    return { uri, pointer: [] };
  }
  if (!fragment.startsWith("/")) {
    return { uri, pointer: [unescapePointer(fragment)] };
  }
  return {
    uri,
    pointer: fragment
      .split("/")
      .slice(1)
      .map((part) => unescapePointer(part)),
  };
}
