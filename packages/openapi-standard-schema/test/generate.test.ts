import { ParsedServiceFromParsedOpenApi } from "@shipworthy/openapi-transformer";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { standardSchema } from "../src/index";

function document(
  openapi: string,
  schemas: Record<string, unknown>,
  defs?: Record<string, unknown>,
) {
  return {
    openapi,
    info: { title: "Fixture", version: "1" },
    paths: {},
    components: { schemas },
    ...(defs ? { $defs: defs } : {}),
  };
}

function sourceFor(
  openapi: string,
  schemas: Record<string, unknown>,
  defs?: Record<string, unknown>,
) {
  const generated = standardSchema.generate(
    Effect.runSync(
      Schema.decodeUnknownEffect(ParsedServiceFromParsedOpenApi)(document(openapi, schemas, defs)),
    ),
    {},
  );

  if (Effect.isEffect(generated)) return generated;
  return Effect.succeed(generated);
}

async function load(source: string) {
  const directory = await mkdtemp(resolve(import.meta.dirname, ".generation-"));
  const file = resolve(directory, "schemas.ts");
  await writeFile(file, source);
  const module = (await import(pathToFileURL(file).href)) as Record<string, StandardSchema>;

  return {
    module,
    async dispose() {
      await rm(directory, { recursive: true, force: true });
    },
  };
}

interface StandardResult {
  readonly value?: unknown;
  readonly issues?: readonly unknown[];
}

interface StandardSchema {
  readonly "~standard": {
    readonly validate: (value: unknown) => StandardResult | Promise<StandardResult>;
  };
}

function validate(schema: StandardSchema, value: unknown): StandardResult {
  const result = schema["~standard"].validate(value);
  if (result instanceof Promise) throw new Error("Expected synchronous validation");
  return result;
}

it.effect("preserves reference-shaped literal annotations while rewriting nested schemas", () =>
  Effect.gen(function* () {
    const literal = { $ref: "#/components/schemas/User" };

    const source = yield* sourceFor("3.1.0", {
      User: { type: "string" },
      Account: {
        type: "object",
        examples: [literal],
        default: literal,
        properties: {
          user: { $ref: "#/components/schemas/User" },
          nested: {
            type: "array",
            items: { $ref: "#/components/schemas/User" },
            examples: [[literal]],
          },
        },
      },
    });

    assert.match(source, /"user": Schema\.optionalKey\(UserSchema\)/);
    assert.match(source, /Schema\.Array\(UserSchema\)/);
    assert.match(source, /"examples": \[\{ "\$ref": "#\/components\/schemas\/User" \}\]/);
    assert.match(source, /"default": \{ "\$ref": "#\/components\/schemas\/User" \}/);
    assert.doesNotMatch(source, /"\$ref": "#\/\$defs\/UserSchema"/);

    const loaded = yield* Effect.tryPromise(() => load(source));

    try {
      assert.deepEqual(validate(loaded.module.Account!, { user: "Ada", nested: ["Grace"] }).value, {
        user: "Ada",
        nested: ["Grace"],
      });

      assert.ok(validate(loaded.module.Account!, { nested: [1] }).issues);
    } finally {
      yield* Effect.tryPromise(() => loaded.dispose());
    }
  }),
);

it.effect("keeps a property named like the component it references", () =>
  Effect.gen(function* () {
    const source = yield* sourceFor("3.1.0", {
      User: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
      },
      Account: {
        type: "object",
        properties: { User: { $ref: "#/components/schemas/User" } },
      },
    });

    assert.match(source, /"User": Schema\.optionalKey\(UserSchema\)/);
    assert.doesNotMatch(source, /UserSchema:\s*UserSchema/);

    const loaded = yield* Effect.tryPromise(() => load(source));

    try {
      assert.deepEqual(validate(loaded.module.User!, { name: "Ada" }).value, { name: "Ada" });
      assert.ok(validate(loaded.module.User!, { name: 1 }).issues);

      assert.deepEqual(validate(loaded.module.Account!, { User: { name: "Ada" } }).value, {
        User: { name: "Ada" },
      });

      assert.ok(validate(loaded.module.Account!, { User: { name: 1 } }).issues);
    } finally {
      yield* Effect.tryPromise(() => loaded.dispose());
    }
  }),
);

it.effect("emits suspend for mutually recursive schemas", () =>
  Effect.gen(function* () {
    const source = yield* sourceFor("3.1.0", {
      Node: {
        type: "object",
        properties: { tree: { $ref: "#/components/schemas/Tree" } },
      },
      Tree: {
        type: "object",
        properties: { node: { $ref: "#/components/schemas/Node" } },
      },
    });

    assert.match(source, /Schema\.suspend\(\(\): Schema\.Codec<NodeSchema> =>/);
    assert.match(source, /Schema\.suspend\(\(\): Schema\.Codec<TreeSchema> =>/);

    const loaded = yield* Effect.tryPromise(() => load(source));

    try {
      assert.deepEqual(validate(loaded.module.Node!, { tree: { node: {} } }).value, {
        tree: { node: {} },
      });

      assert.ok(validate(loaded.module.Tree!, { node: { tree: 1 } }).issues);
    } finally {
      yield* Effect.tryPromise(() => loaded.dispose());
    }
  }),
);

it.effect("does not replace a component with a nested $def of the same name", () =>
  Effect.gen(function* () {
    const source = yield* sourceFor("3.1.0", {
      User: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
      },
      Label: {
        $ref: "#/$defs/User",
        $defs: { User: { type: "string" } },
      },
    });

    const loaded = yield* Effect.tryPromise(() => load(source));

    try {
      assert.deepEqual(validate(loaded.module.User!, { name: "Ada" }).value, { name: "Ada" });
      assert.ok(validate(loaded.module.User!, "Ada").issues);
      assert.equal(validate(loaded.module.Label!, "Ada").value, "Ada");
      assert.ok(validate(loaded.module.Label!, { name: "Ada" }).issues);
    } finally {
      yield* Effect.tryPromise(() => loaded.dispose());
    }
  }),
);

it.effect("reads a document $def that shares a component name", () =>
  Effect.gen(function* () {
    const source = yield* sourceFor(
      "3.1.0",
      { Name: { $ref: "#/$defs/Name" } },
      { Name: { type: "string", minLength: 1 } },
    );

    const loaded = yield* Effect.tryPromise(() => load(source));

    try {
      assert.equal(validate(loaded.module.Name!, "Ada").value, "Ada");
      assert.ok(validate(loaded.module.Name!, "").issues);
    } finally {
      yield* Effect.tryPromise(() => loaded.dispose());
    }
  }),
);

it.effect("converts nullable strings", () =>
  Effect.gen(function* () {
    const source = yield* sourceFor("3.1.0", { Name: { type: ["string", "null"] } });
    assert.match(source, /Schema\.Union\(\[Schema\.String, Schema\.Null\]\)/);

    const loaded = yield* Effect.tryPromise(() => load(source));

    try {
      assert.equal(validate(loaded.module.Name!, "Ada").value, "Ada");
      assert.equal(validate(loaded.module.Name!, null).value, null);
      assert.ok(validate(loaded.module.Name!, 1).issues);
    } finally {
      yield* Effect.tryPromise(() => loaded.dispose());
    }
  }),
);

it.effect("applies string patterns", () =>
  Effect.gen(function* () {
    const source = yield* sourceFor("3.1.0", { Code: { type: "string", pattern: "^a+$" } });
    assert.match(source, /Schema\.isPattern\(new RegExp\("\^a\+\$", "u"\)\)/);

    const loaded = yield* Effect.tryPromise(() => load(source));

    try {
      assert.equal(validate(loaded.module.Code!, "aaa").value, "aaa");
      assert.ok(validate(loaded.module.Code!, "b").issues);
    } finally {
      yield* Effect.tryPromise(() => loaded.dispose());
    }
  }),
);

it.effect("imports a false schema as never", () =>
  Effect.gen(function* () {
    const source = yield* sourceFor("3.1.0", { Empty: false });
    assert.match(source, /Schema\.Never/);

    const loaded = yield* Effect.tryPromise(() => load(source));

    try {
      assert.ok(validate(loaded.module.Empty!, null).issues);
      assert.ok(validate(loaded.module.Empty!, {}).issues);
    } finally {
      yield* Effect.tryPromise(() => loaded.dispose());
    }
  }),
);

it.effect("returns an empty module when the document has no component schemas", () =>
  Effect.gen(function* () {
    assert.equal(yield* sourceFor("3.1.0", {}), "");
  }),
);

it.effect("does not mutate the model while rewriting decoded schema children", () =>
  Effect.gen(function* () {
    const model = yield* Schema.decodeUnknownEffect(ParsedServiceFromParsedOpenApi)(
      document("3.1.0", {
        User: { type: "string" },
        Account: { type: "object", properties: { user: { $ref: "#/components/schemas/User" } } },
      }),
    );

    const before = structuredClone(model);
    const generated = standardSchema.generate(model, {});
    const source = Effect.isEffect(generated) ? yield* generated : generated;
    assert.match(source, /"user": Schema\.optionalKey\(UserSchema\)/);
    assert.deepEqual(model, before);
  }),
);

it.effect("keeps synchronous schema evaluation failures in the generation error channel", () =>
  Effect.gen(function* () {
    const model = yield* Schema.decodeUnknownEffect(ParsedServiceFromParsedOpenApi)(
      document("3.1.0", {}),
    );

    const schema = Object.defineProperty({}, "description", {
      enumerable: true,
      get: () => {
        throw new Error("schema getter failed");
      },
    });

    const generated = standardSchema.generate(
      {
        ...model,
        components: { ...model.components, schemas: { Explosive: schema } },
      },
      {},
    );

    const error = yield* Effect.flip(
      Effect.isEffect(generated) ? generated : Effect.succeed(generated),
    );

    assert.equal(error._tag, "SchemaGenerationError");
    assert.ok(error.cause instanceof Error);
    assert.equal(error.message, error.cause.message);
  }),
);
