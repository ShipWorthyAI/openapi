import type { ParsedDiscriminator, ParsedService } from "@shipworthy/openapi-transformer";
import {
  Array as EffectArray,
  Config,
  Console,
  Effect,
  type JsonSchema,
  Predicate,
  Record as EffectRecord,
  Result,
} from "effect";
import ts from "#compiler";
import { escapePointer, parseRef } from "./ref.ts";
import { discriminatorOf, stringList } from "./schema.ts";
import { tsLiteral, tsModifiers, tsPropertyIndex } from "./ts.ts";

/** Same TTY and `NO_COLOR` check as `CliOutput.defaultFormatter`. */
function colorsEnabled(): boolean {
  const current = globalThis.process;

  if (typeof current !== "object" || current === null) return false;

  const stdout = current.stdout;

  if (typeof stdout !== "object" || stdout === null) return false;

  // oxlint-disable-next-line effecttsgo/process-env -- The exported synchronous resolveRef API must format warnings before returning.
  return stdout.isTTY === true && !current.env?.NO_COLOR;
}

function paint(code: string) {
  return (text: string) => (colorsEnabled() ? `\x1b[${code}m${text}\x1b[0m` : text);
}

const colors = {
  bold: paint("1"),
  green: paint("32"),
  yellow: paint("33"),
  blue: paint("34"),
  magenta: paint("35"),
  cyan: paint("36"),
  white: paint("37"),
};

const DEBUG_GROUPS: Record<string, ((text: string) => string) | undefined> = {
  config: colors.cyan,
  lint: colors.yellow,
  bundle: colors.magenta,
  ts: colors.blue,
};

/** Given a discriminator object, get the property name */
export function createDiscriminatorProperty(
  discriminator: ParsedDiscriminator,
  { path, readonly = false }: { path: string; readonly?: boolean },
): ts.TypeElement {
  // get the inferred propertyName value from the last section of the path (as the spec suggests to do)
  let value = parseRef(path).pointer.pop();

  // if mapping, and there’s a match, use this rather than the inferred name
  if (discriminator.mapping) {
    // Mapping value can either be a fully-qualified ref (#/components/schemas/XYZ) or a schema name (XYZ)
    const matchedValue = Object.entries(discriminator.mapping).find(
      ([, v]) =>
        (!v.startsWith("#") && v === value) ||
        (v.startsWith("#") && parseRef(v).pointer.pop() === value),
    );

    if (matchedValue) {
      value = matchedValue[0]; // why was this designed backwards!?
    }
  }

  return ts.factory.createPropertySignature(
    /* modifiers     */ tsModifiers({
      readonly,
    }),
    /* name          */ tsPropertyIndex(discriminator.propertyName),
    /* questionToken */ undefined,
    /* type          */ tsLiteral(value),
  );
}

/** Create a $ref pointer (even from other $refs) */
export function createRef(parts: (number | string | undefined | null)[]): string {
  let pointer = "#";

  for (const part of parts) {
    if (part === undefined || part === null || part === "") {
      continue;
    }

    const maybeRef = parseRef(String(part)).pointer;

    if (maybeRef.length) {
      for (const refPart of maybeRef) {
        pointer += `/${escapePointer(refPart)}`;
      }
    } else {
      pointer += `/${escapePointer(String(part))}`;
    }
  }

  return pointer;
}

/** Print debug message (cribbed from the `debug` package, but without all the bells & whistles */
export const debug = Effect.fnUntraced(function* (msg: string, group?: string, time?: number) {
  const setting = yield* Config.String("DEBUG").pipe(Config.withDefault(""), Effect.orDie);

  if (
    setting &&
    (!group ||
      setting === "*" ||
      setting === "openapi-ts:*" ||
      setting.toLocaleLowerCase() === `openapi-ts:${group.toLocaleLowerCase()}`)
  ) {
    const groupColor = (group && DEBUG_GROUPS[group]) || colors.white;
    const groupName = groupColor(`openapi-ts:${group ?? "info"}`);
    let timeFormatted = "";

    if (typeof time === "number") {
      timeFormatted = colors.green(` ${formatTime(time)} `);
    }

    yield* Console.debug(`  ${colors.bold(groupName)}${timeFormatted}${msg}`);
  }
});

/** Format a performance log in a friendly format */
export function formatTime(t: number) {
  if (typeof t === "number") {
    if (t < 1000) {
      return `${Math.round(10 * t) / 10}ms`;
    }

    if (t < 60000) {
      return `${Math.round(t / 100) / 10}s`;
    }

    return `${Math.round(t / 6000) / 10}m`;
  }

  return t;
}

/** Follow a local `$ref` through a parsed model. Its components, `$defs`, and path maps keep the document's keys. */
export function resolveRef<T = unknown>(
  model: unknown,
  $ref: string,
  { silent = false, visited = [] }: { silent?: boolean; visited?: string[] },
): T | undefined {
  const { pointer } = parseRef($ref);

  if (!pointer.length) {
    return undefined;
  }

  let node: unknown = model;

  for (const key of pointer) {
    const next = Predicate.isObject(node) ? node[key] : undefined;

    if (next === undefined || next === null) {
      warn(`Could not resolve $ref "${$ref}"`, silent);
      return undefined;
    }

    node = next;
  }

  // if this is also a $ref, keep tracing
  if (Predicate.isObject(node) && typeof node.$ref === "string") {
    if (visited.includes(node.$ref)) {
      warn(`Could not resolve circular $ref "${$ref}"`, silent);
      return undefined;
    }

    return resolveRef<T>(model, node.$ref, { silent, visited: [...visited, node.$ref] });
  }

  return node as T;
}

function createDiscriminatorEnum(values: string[], prevSchema?: unknown): JsonSchema.JsonSchema {
  const description =
    Predicate.isObject(prevSchema) && typeof prevSchema.description === "string"
      ? prevSchema.description
      : undefined;

  return {
    type: "string",
    enum: values,
    description: description
      ? `${description} (enum property replaced by openapi-typescript)`
      : "discriminator enum property added by openapi-typescript",
  };
}

/** Adds or replaces the discriminator enum with the passed `values` in a schema defined by `ref` */
function patchDiscriminatorEnum(
  model: ParsedService,
  ref: string,
  values: string[],
  discriminator: ParsedDiscriminator,
  discriminatorRef: string,
  silent: boolean,
): boolean {
  // the scan patches schemas in place
  const resolved = resolveRef<unknown>(model, ref, { silent });
  const resolvedSchema = Predicate.isObject(resolved) ? resolved : undefined;

  if (Array.isArray(resolvedSchema?.allOf)) {
    // if the schema is an allOf, we can append a new schema object to the allOf array
    resolvedSchema.allOf.push({
      type: "object",
      // discriminator enum properties always need to be required
      required: [discriminator.propertyName],
      properties: {
        [discriminator.propertyName]: createDiscriminatorEnum(values),
      },
    });

    return true;
  } else if (resolvedSchema?.type === "object") {
    // if the schema is an object, we can apply the discriminator enums to its properties
    const properties = Predicate.isObject(resolvedSchema.properties)
      ? resolvedSchema.properties
      : {};

    // discriminator enum properties always need to be required
    const required = stringList(resolvedSchema.required) ?? [];

    if (!required.includes(discriminator.propertyName)) {
      resolvedSchema.required = [...required, discriminator.propertyName];
    }

    // add/replace the discriminator enum property
    resolvedSchema.properties = {
      ...properties,
      [discriminator.propertyName]: createDiscriminatorEnum(
        values,
        properties[discriminator.propertyName],
      ),
    };

    return true;
  }

  warn(
    `Discriminator mapping has an invalid schema (neither an object schema nor an allOf array): ${ref} => ${values.join(
      ", ",
    )} (Discriminator: ${discriminatorRef})`,
    silent,
  );

  return false;
}

function discriminatorMappingRef(target: string): string {
  if (target.startsWith("#")) return target;
  return `#/components/schemas/${target.replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

/** Values that select a referenced branch of one discriminated union. */
export function discriminatorValues(discriminator: ParsedDiscriminator, ref: string): string[] {
  const name = parseRef(ref).pointer.at(-1);
  if (!name) return [];

  const mapped = EffectArray.map(
    EffectArray.filter(
      EffectRecord.toEntries(discriminator.mapping ?? {}),
      ([, target]) => discriminatorMappingRef(target) === ref,
    ),
    ([value]) => value,
  );

  if (mapped.length > 0) return mapped;
  return Object.hasOwn(discriminator.mapping ?? {}, name) ? [] : [name];
}

/**
 * Collect the discriminators of a parsed model, keyed by JSON Pointer. Schemas a discriminator
 * maps to get its property as an enum of all mapped values, in place.
 */
export const scanDiscriminators = Effect.fnUntraced(function* (
  model: ParsedService,
  { silent = false }: { silent?: boolean },
) {
  // all discriminator objects found in the schema
  const objects: Record<string, ParsedDiscriminator> = {};

  const pendingConstraints = new Map<
    string,
    { values: string[]; discriminator: ParsedDiscriminator; source: string } | null
  >();

  function queueDiscriminatorValues(
    ref: string,
    values: string[],
    discriminator: ParsedDiscriminator,
    source: string,
  ) {
    const existing = pendingConstraints.get(ref);
    if (existing === null) return;

    if (existing) {
      if (existing.discriminator.propertyName === discriminator.propertyName) {
        existing.values = EffectArray.dedupe([...existing.values, ...values]);
      } else {
        // Each union narrows its branch locally; a shared component has no single tag property.
        pendingConstraints.set(ref, null);
      }

      return;
    }

    pendingConstraints.set(ref, { values, discriminator, source });
  }

  // perform 2 passes: first, collect all discriminator definitions and handle oneOf and mappings
  walk(model, (obj, path) => {
    const discriminator = discriminatorOf(obj.discriminator);

    if (!discriminator) {
      return;
    }

    // collect discriminator object for later usage
    const ref = createRef(path);

    objects[ref] = discriminator;

    // Infer discriminator values for referenced oneOf and anyOf branches.
    if (!Array.isArray(obj.oneOf) && !Array.isArray(obj.anyOf)) {
      return;
    }

    // Include referenced branches and explicit mappings, including mapped schemas outside the union.
    const branches = [
      ...(Array.isArray(obj.oneOf) ? obj.oneOf : []),
      ...(Array.isArray(obj.anyOf) ? obj.anyOf : []),
    ];

    const branchRefs = EffectArray.filterMap(branches, (item) =>
      Predicate.isObject(item) && typeof item.$ref === "string"
        ? Result.succeed(item.$ref)
        : Result.failVoid,
    );

    const mappedRefs = EffectArray.map(
      EffectArray.filter(EffectRecord.values(discriminator.mapping ?? {}), (target) => !!target),
      discriminatorMappingRef,
    );

    const references = EffectArray.dedupe([...branchRefs, ...mappedRefs]);

    EffectArray.forEach(references, (mappedRef) => {
      const mappedValues = discriminatorValues(discriminator, mappedRef);
      if (mappedValues.length > 0)
        queueDiscriminatorValues(mappedRef, mappedValues, discriminator, ref);
    });
  });

  // second, collect the schema objects that inherit from discriminators
  // (sometimes this mapping is implicit, so it can’t be done until we know
  // about every discriminator in the document)
  walk(model, (obj, path) => {
    if (!Array.isArray(obj.allOf)) {
      return;
    }

    for (const item of obj.allOf) {
      if (!Predicate.isObject(item)) {
        continue;
      }

      if (typeof item.$ref === "string") {
        const parent = objects[item.$ref];

        if (!parent) {
          return;
        }

        const ref = createRef(path);
        const mappedValues: string[] = [];

        for (const [mappedValue, target] of Object.entries(parent.mapping ?? {})) {
          if (discriminatorMappingRef(target) === ref) {
            mappedValues.push(mappedValue);
          }
        }

        if (mappedValues.length > 0) queueDiscriminatorValues(ref, mappedValues, parent, item.$ref);

        objects[ref] = { ...parent };
      } else {
        const discriminator = discriminatorOf(item.discriminator);

        if (discriminator) {
          objects[createRef(path)] = { ...discriminator };
        }
      }
    }
  });

  const patchable = EffectArray.filterMap(pendingConstraints, ([ref, constraint]) =>
    constraint === null ? Result.failVoid : Result.succeed([ref, constraint] as const),
  );

  const refsHandled = yield* Effect.forEach(patchable, ([ref, { values, discriminator, source }]) =>
    Effect.sync(() =>
      patchDiscriminatorEnum(model, ref, values, discriminator, source, silent) ? ref : undefined,
    ),
  ).pipe(Effect.map((refs) => EffectArray.filter(refs, Predicate.isNotUndefined)));

  return { objects, refsHandled };
});

/** Walk through any JSON-serializable (i.e. non-circular) object */
export function walk(
  obj: unknown,
  cb: (value: Record<string, unknown>, path: (string | number)[]) => void,
  path: (string | number)[] = [],
): void {
  if (!obj || typeof obj !== "object") {
    return;
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      walk(obj[i], cb, path.concat(i));
    }

    return;
  }

  cb(obj as Record<string, unknown>, path);

  for (const k of Object.keys(obj)) {
    walk((obj as Record<string, unknown>)[k], cb, path.concat(k));
  }
}

/** Print warning message */
function warn(msg: string, silent = false) {
  if (!silent) {
    // oxlint-disable-next-line effecttsgo/global-console -- Preserve warnings from the synchronous public resolveRef API and compiler callbacks.
    console.warn(colors.yellow(` ⚠  ${msg}`));
  }
}
