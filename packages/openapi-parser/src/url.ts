import * as NodePath from "@effect/platform-node/NodePath";
import { fileURLToPath } from "node:url";
import { Array as Arr, Effect, Option, Path, pipe, String as Str } from "effect";
import { ResolverFailure, nodeErrorCode } from "./errors.ts";

const unsafeDomainSuffixes = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".corp",
  ".home",
  ".lan",
];

export interface ResolvedUrlAddress {
  address: string;
  family: number;
}

export interface UrlSafety {
  unsafe: boolean;
  addresses?: ResolvedUrlAddress[];
}

export function stripHash(value: string): string {
  return pipe(
    value,
    Str.indexOf("#"),
    Option.match({ onNone: () => value, onSome: (index) => Str.slice(0, index)(value) }),
  );
}

export function getHash(value: string): string {
  return pipe(
    value,
    Str.indexOf("#"),
    Option.match({ onNone: () => "#", onSome: (index) => Str.slice(index)(value) || "#" }),
  );
}

export function isHttp(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function isFileSystemPath(value: string | undefined): boolean {
  if (!value) return false;
  if (Str.startsWith("file:")(value)) return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(value);
}

export function httpOrigin(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

export const normalizeRef = Effect.fnUntraced(function* (input: string | undefined) {
  if (input && /^[a-z][a-z0-9+.-]*:/i.test(input)) return input;
  const path = yield* Path.Path;

  const absolute =
    !input || input === "/" ? `${path.resolve(".")}${path.sep}` : path.resolve(input);

  return yield* path.toFileUrl(absolute).pipe(
    Effect.map((url) => url.href),
    Effect.mapError(
      (cause) =>
        new ResolverFailure({
          message: cause.message,
          source: input ?? "",
          cause,
        }),
    ),
  );
}, Effect.provide(NodePath.layer));

export function resolveAgainst(from: string, to: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(to)) return to;
  return new URL(to, stripHash(from)).href;
}

export function toFileSystemPath(ref: string): string {
  const withoutHash = stripHash(ref);
  if (Str.startsWith("file:")(withoutHash)) return fileURLToPath(withoutHash);
  return withoutHash;
}

export function extensionOf(ref: string): string {
  const pathname = pipe(stripHash(ref), Str.split("?"), Arr.headNonEmpty);
  const base = pipe(pathname, Str.split(/[/\\]/), Arr.lastNonEmpty);

  return pipe(
    base,
    Str.lastIndexOf("."),
    Option.match({
      onNone: () => "",
      onSome: (dot) => pipe(base, Str.slice(dot), Str.toLowerCase),
    }),
  );
}

export function isUnsafeUrl(value: string): boolean {
  const normalized = pipe(value, Str.trim, Str.toLowerCase);
  if (!normalized) return true;

  if (
    Str.startsWith("javascript:")(normalized) ||
    Str.startsWith("vbscript:")(normalized) ||
    Str.startsWith("data:")(normalized)
  ) {
    return true;
  }

  if (Str.startsWith("file:")(normalized)) return true;

  try {
    const url = new URL(Str.startsWith("//")(normalized) ? `http:${normalized}` : normalized);
    if (isUnsafeHostname(url.hostname)) return true;
    if (url.port && isInternalPort(Number(url.port))) return true;
  } catch {
    return false;
  }

  return false;
}

export function isAllowedOrigin(
  href: string,
  allowedOrigins: readonly string[] | undefined,
): boolean {
  const origin = httpOrigin(href);
  if (!origin || !allowedOrigins?.length) return false;
  return Arr.some(allowedOrigins, (allowed) => httpOrigin(allowed) === origin);
}

export const resolveUrlSafety = Effect.fnUntraced(function* (href: string) {
  if (isUnsafeUrl(href)) return { unsafe: true };
  if (typeof process === "undefined" || !process.versions?.node) return { unsafe: false };
  const parsed = URL.parse(Str.startsWith("//")(href) ? `http:${href}` : href);
  if (parsed === null) return { unsafe: true };

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { unsafe: false };

  const onError = (cause: unknown) =>
    new ResolverFailure({
      message: `Error downloading ${href}: ${cause instanceof Error ? cause.message : String(cause)}`,
      source: href,
      cause,
      ...ioCode(cause),
    });

  const dns = yield* Effect.tryPromise({
    try: () => import("node:dns/promises"),
    catch: onError,
  });

  const addresses = yield* Effect.tryPromise({
    try: () => dns.lookup(normalizeHostname(parsed.hostname), { all: true, verbatim: true }),
    catch: onError,
  });

  if (addresses.length === 0 || Arr.some(addresses, ({ address }) => isUnsafeHostname(address))) {
    return { unsafe: true };
  }

  return { unsafe: false, addresses };
});

export function isUnsafeHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return true;
  if (
    normalized === "localhost" ||
    Arr.some(unsafeDomainSuffixes, (suffix) => Str.endsWith(suffix)(normalized))
  )
    return true;
  const ipv4 = parseIPv4Address(normalized);
  if (ipv4) return isUnsafeIPv4Address(ipv4);
  const ipv6 = parseIPv6Address(normalized);
  if (ipv6) return isUnsafeIPv6Address(ipv6);
  return false;
}

function ioCode(cause: unknown): { ioErrorCode: string } | undefined {
  const ioErrorCode = nodeErrorCode(cause);
  return ioErrorCode ? { ioErrorCode } : undefined;
}

function normalizeHostname(hostname: string): string {
  let normalized: string = pipe(hostname, Str.trim, Str.toLowerCase);
  if (Str.startsWith("[")(normalized) && Str.endsWith("]")(normalized))
    normalized = Str.slice(1, -1)(normalized);
  while (Str.endsWith(".")(normalized)) normalized = Str.slice(0, -1)(normalized);
  return normalized;
}

function parseIPv4Address(ip: string): number[] | undefined {
  const parts = Str.split(ip, ".");
  if (parts.length !== 4) return undefined;
  const octets = Arr.map(parts, (part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
  if (Arr.some(octets, (octet) => !Number.isInteger(octet) || octet < 0 || octet > 255))
    return undefined;
  return octets;
}

function isUnsafeIPv4Address(octets: readonly number[]): boolean {
  const a = octets[0];
  const b = octets[1];
  const c = octets[2];
  const d = octets[3];
  if (a === undefined || b === undefined || c === undefined || d === undefined) return true;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 ||
    (a === 255 && b === 255 && c === 255 && d === 255)
  );
}

function parseIPv6Address(ip: string): number[] | undefined {
  const separator = Str.lastIndexOf(":")(ip);
  if (Option.isNone(separator)) return undefined;
  let normalized = ip;
  const lastSeparator = separator.value;
  const possibleIPv4 = Str.slice(lastSeparator + 1)(normalized);

  if (Str.includes(".")(possibleIPv4)) {
    const ipv4 = parseIPv4Address(possibleIPv4);
    if (!ipv4) return undefined;
    const firstGroup = ipv4[0]! * 256 + ipv4[1]!;
    const secondGroup = ipv4[2]! * 256 + ipv4[3]!;
    normalized = `${Str.slice(0, lastSeparator + 1)(normalized)}${firstGroup.toString(16)}:${secondGroup.toString(16)}`;
  }

  const halves = Str.split(normalized, "::");
  if (halves.length > 2) return undefined;
  const head = parseIPv6Groups(Arr.headNonEmpty(halves));
  const tail = halves.length === 2 ? parseIPv6Groups(halves[1] ?? "") : [];
  if (!head || !tail) return undefined;
  if (halves.length === 1) return head.length === 8 ? head : undefined;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return undefined;
  return [...head, ...Array<number>(missing).fill(0), ...tail];
}

function parseIPv6Groups(groups: string): number[] | undefined {
  if (!groups) return [];

  const parsed = pipe(
    groups,
    Str.split(":"),
    Arr.map((group) => (/^[\da-f]{1,4}$/i.test(group) ? Number.parseInt(group, 16) : Number.NaN)),
  );

  if (Arr.some(parsed, (group) => !Number.isInteger(group) || group < 0 || group > 0xffff))
    return undefined;
  return parsed;
}

function isUnsafeIPv6Address(groups: number[]): boolean {
  if (groups.length !== 8) return false;
  const unspecified = Arr.every(groups, (group) => group === 0);
  const loopback = Arr.every(groups.slice(0, 7), (group) => group === 0) && groups[7] === 1;
  const uniqueLocal = (groups[0]! & 0xfe00) === 0xfc00;
  const linkLocal = (groups[0]! & 0xffc0) === 0xfe80;
  const multicast = (groups[0]! & 0xff00) === 0xff00;
  if (unspecified || loopback || uniqueLocal || linkLocal || multicast) return true;
  const mapped = mappedIPv4(groups);
  return mapped ? isUnsafeIPv4Address(mapped) : false;
}

function mappedIPv4(groups: number[]): number[] | undefined {
  const firstFive = Arr.every(groups.slice(0, 5), (group) => group === 0);
  const firstSix = firstFive && groups[5] === 0;
  const v4Mapped = firstFive && groups[5] === 0xffff;
  if (!firstSix && !v4Mapped) return undefined;

  return [
    Math.floor(groups[6]! / 256),
    groups[6]! % 256,
    Math.floor(groups[7]! / 256),
    groups[7]! % 256,
  ];
}

function isInternalPort(port: number): boolean {
  return [
    22, 23, 25, 53, 135, 139, 445, 993, 995, 1433, 1521, 3306, 3389, 5432, 5900, 6379, 8080, 8443,
    9200, 27017,
  ].includes(port);
}
