import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Effect } from "effect";
import { ResolverFailure } from "./errors.js";

const unsafeDomainSuffixes = [".localhost", ".local", ".internal", ".intranet", ".corp", ".home", ".lan"];

export interface ResolvedUrlAddress {
  address: string;
  family: number;
}

export interface UrlSafety {
  unsafe: boolean;
  addresses?: ResolvedUrlAddress[];
}

export function stripHash(value: string): string {
  const index = value.indexOf("#");
  return index === -1 ? value : value.slice(0, index);
}

export function getHash(value: string): string {
  const index = value.indexOf("#");
  if (index === -1) return "#";
  return value.slice(index) || "#";
}

export function isHttp(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function isFileSystemPath(value: string | undefined): boolean {
  if (!value) return false;
  if (value.startsWith("file:")) return true;
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

export function normalizeRef(input: string | undefined): string {
  if (!input || input === "/") return pathToFileURL(`${process.cwd()}${path.sep}`).href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(input)) return input;
  return pathToFileURL(path.resolve(input)).href;
}

export function resolveAgainst(from: string, to: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(to)) return to;
  return new URL(to, stripHash(from)).href;
}

export function toFileSystemPath(ref: string): string {
  const withoutHash = stripHash(ref);
  if (withoutHash.startsWith("file:")) return fileURLToPath(withoutHash);
  return withoutHash;
}

export function extensionOf(ref: string): string {
  const pathname = stripHash(ref).split("?")[0] ?? "";
  const base = pathname.slice(Math.max(pathname.lastIndexOf("/"), pathname.lastIndexOf("\\")) + 1);
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot).toLowerCase() : "";
}

export function isUnsafeUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.startsWith("javascript:") || normalized.startsWith("vbscript:") || normalized.startsWith("data:")) {
    return true;
  }
  if (normalized.startsWith("file:")) return true;
  try {
    const url = new URL(normalized.startsWith("//") ? `http:${normalized}` : normalized);
    if (isUnsafeHostname(url.hostname)) return true;
    if (url.port && isInternalPort(Number(url.port))) return true;
  } catch {
    return false;
  }
  return false;
}

export function isAllowedOrigin(href: string, allowedOrigins: readonly string[] | undefined): boolean {
  const origin = httpOrigin(href);
  if (!origin || !allowedOrigins?.length) return false;
  return allowedOrigins.some((allowed) => httpOrigin(allowed) === origin);
}

export const resolveUrlSafety = Effect.fnUntraced(function* (href: string) {
  if (isUnsafeUrl(href)) return { unsafe: true };
  if (typeof process === "undefined" || !process.versions?.node) return { unsafe: false };
  let parsed: URL;
  try {
    parsed = new URL(href.startsWith("//") ? `http:${href}` : href);
  } catch {
    return { unsafe: true };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { unsafe: false };
  const addresses = yield* Effect.tryPromise({
    try: async () => {
      const dns = (await import("node:dns/promises")) as {
        lookup(
          hostname: string,
          options: { all: true; verbatim: true },
        ): Promise<ResolvedUrlAddress[]>;
      };
      return dns.lookup(normalizeHostname(parsed.hostname), { all: true, verbatim: true });
    },
    catch: (cause) =>
      new ResolverFailure({
        message: `Error downloading ${href}: ${cause instanceof Error ? cause.message : String(cause)}`,
        source: href,
        ioErrorCode: codeOf(cause),
      }),
  });
  if (addresses.length === 0 || addresses.some(({ address }) => isUnsafeHostname(address))) {
    return { unsafe: true };
  }
  return { unsafe: false, addresses };
});

export function isUnsafeHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return true;
  if (normalized === "localhost" || unsafeDomainSuffixes.some((suffix) => normalized.endsWith(suffix))) return true;
  const ipv4 = parseIPv4Address(normalized);
  if (ipv4) return isUnsafeIPv4Address(ipv4);
  const ipv6 = parseIPv6Address(normalized);
  if (ipv6) return isUnsafeIPv6Address(ipv6);
  return false;
}

function codeOf(cause: unknown): string {
  if (typeof cause === "object" && cause !== null && "code" in cause && cause.code != null) return String(cause.code);
  return "";
}

function normalizeHostname(hostname: string): string {
  let normalized = hostname.trim().toLowerCase();
  if (normalized.startsWith("[") && normalized.endsWith("]")) normalized = normalized.slice(1, -1);
  while (normalized.endsWith(".")) normalized = normalized.slice(0, -1);
  return normalized;
}

function parseIPv4Address(ip: string): number[] | undefined {
  const parts = ip.split(".");
  if (parts.length !== 4) return undefined;
  const octets = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return undefined;
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
  if (!ip.includes(":")) return undefined;
  let normalized = ip;
  const lastSeparator = normalized.lastIndexOf(":");
  const possibleIPv4 = normalized.slice(lastSeparator + 1);
  if (possibleIPv4.includes(".")) {
    const ipv4 = parseIPv4Address(possibleIPv4);
    if (!ipv4) return undefined;
    const firstGroup = ipv4[0]! * 256 + ipv4[1]!;
    const secondGroup = ipv4[2]! * 256 + ipv4[3]!;
    normalized = `${normalized.slice(0, lastSeparator + 1)}${firstGroup.toString(16)}:${secondGroup.toString(16)}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return undefined;
  const head = parseIPv6Groups(halves[0] ?? "");
  const tail = halves.length === 2 ? parseIPv6Groups(halves[1] ?? "") : [];
  if (!head || !tail) return undefined;
  if (halves.length === 1) return head.length === 8 ? head : undefined;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return undefined;
  return [...head, ...Array<number>(missing).fill(0), ...tail];
}

function parseIPv6Groups(groups: string): number[] | undefined {
  if (!groups) return [];
  const parsed = groups.split(":").map((group) => (/^[\da-f]{1,4}$/i.test(group) ? Number.parseInt(group, 16) : Number.NaN));
  if (parsed.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) return undefined;
  return parsed;
}

function isUnsafeIPv6Address(groups: number[]): boolean {
  if (groups.length !== 8) return false;
  const unspecified = groups.every((group) => group === 0);
  const loopback = groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  const uniqueLocal = (groups[0]! & 0xfe00) === 0xfc00;
  const linkLocal = (groups[0]! & 0xffc0) === 0xfe80;
  const multicast = (groups[0]! & 0xff00) === 0xff00;
  if (unspecified || loopback || uniqueLocal || linkLocal || multicast) return true;
  const mapped = mappedIPv4(groups);
  return mapped ? isUnsafeIPv4Address(mapped) : false;
}

function mappedIPv4(groups: number[]): number[] | undefined {
  const firstFive = groups.slice(0, 5).every((group) => group === 0);
  const firstSix = firstFive && groups[5] === 0;
  const v4Mapped = firstFive && groups[5] === 0xffff;
  if (!firstSix && !v4Mapped) return undefined;
  return [Math.floor(groups[6]! / 256), groups[6]! % 256, Math.floor(groups[7]! / 256), groups[7]! % 256];
}

function isInternalPort(port: number): boolean {
  return [
    22, 23, 25, 53, 135, 139, 445, 993, 995, 1433, 1521, 3306, 3389, 5432, 5900, 6379, 8080, 8443, 9200, 27017,
  ].includes(port);
}
