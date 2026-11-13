import { ParsedServiceFromParsedOpenApi } from "@shipworthy/openapi-transformer";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SchemaGenerationError, standardSchema } from "../src/index";

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
    assert.match(source, /Schema\.isPattern\(new globalThis\.RegExp\("\^a\+\$", "u"\)\)/);

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

function modelFor(schemas: Record<string, unknown>, defs?: Record<string, unknown>) {
  return Schema.decodeUnknownEffect(ParsedServiceFromParsedOpenApi)(
    document("3.1.0", schemas, defs),
  );
}

function generateWith(schemas: Record<string, unknown>, options: Record<string, unknown>) {
  return modelFor(schemas).pipe(
    Effect.flatMap((model) => {
      const generated = standardSchema.generate(model, options);
      return Effect.isEffect(generated) ? generated : Effect.succeed(generated);
    }),
  );
}

const snakeCaseSchemas = {
  Address: {
    type: "object",
    required: ["street_line"],
    properties: { street_line: { type: "string" }, postal_code: { type: "string" } },
  },
  Guest: {
    type: "object",
    required: ["first_name", "home_address"],
    properties: {
      first_name: { type: "string" },
      home_address: { $ref: "#/components/schemas/Address" },
      past_stays: {
        type: "array",
        items: {
          type: "object",
          required: ["hotel_id"],
          properties: { hotel_id: { type: "string" } },
        },
      },
      stay_status: { type: "string", enum: ["in_progress", "checked_out"] },
    },
  },
  Reservation: {
    allOf: [
      { $ref: "#/components/schemas/Guest" },
      {
        type: "object",
        required: ["reservation_id"],
        properties: { reservation_id: { type: "string" } },
      },
    ],
  },
};

const snakeNames = [
  "street_line",
  "postal_code",
  "first_name",
  "home_address",
  "past_stays",
  "hotel_id",
  "stay_status",
  "reservation_id",
];

const camelNames = [
  "streetLine",
  "postalCode",
  "firstName",
  "homeAddress",
  "pastStays",
  "hotelId",
  "stayStatus",
  "reservationId",
];

it.effect("camelCase renames snake_case fields in types and validators", () =>
  Effect.gen(function* () {
    const model = yield* modelFor(snakeCaseSchemas);
    const before = structuredClone(model);
    const generated = standardSchema.generate(model, { camelCase: true });
    const source = Effect.isEffect(generated) ? yield* generated : generated;
    assert.deepEqual(model, before);

    for (const name of camelNames) assert.match(source, new RegExp(`"${name}"`), name);
    for (const name of snakeNames) assert.doesNotMatch(source, new RegExp(`"${name}"`), name);

    assert.match(source, /"in_progress"/);
    assert.match(source, /"checked_out"/);
    assert.match(source, /export type Guest = /);

    const loaded = yield* Effect.tryPromise(() => load(source));

    try {
      const guest = {
        firstName: "Ada",
        homeAddress: { streetLine: "1 Main St", postalCode: "12345" },
        pastStays: [{ hotelId: "h1" }],
        stayStatus: "in_progress",
      };

      assert.deepEqual(validate(loaded.module.Guest!, guest).value, guest);

      assert.deepEqual(
        validate(loaded.module.Reservation!, { ...guest, reservationId: "r1" }).value,
        { ...guest, reservationId: "r1" },
      );

      assert.ok(
        validate(loaded.module.Guest!, {
          first_name: "Ada",
          homeAddress: { streetLine: "1 Main St" },
        }).issues,
      );

      assert.ok(
        validate(loaded.module.Guest!, { ...guest, homeAddress: { street_line: "x" } }).issues,
      );

      assert.ok(
        validate(loaded.module.Guest!, { ...guest, pastStays: [{ hotel_id: "h1" }] }).issues,
      );

      assert.ok(validate(loaded.module.Guest!, { ...guest, stayStatus: "inProgress" }).issues);
      assert.ok(validate(loaded.module.Reservation!, { ...guest, reservation_id: "r1" }).issues);
    } finally {
      yield* Effect.tryPromise(() => loaded.dispose());
    }
  }),
);

it.effect("camelCase false or omitted leaves generation unchanged", () =>
  Effect.gen(function* () {
    const omitted = yield* generateWith(snakeCaseSchemas, {});
    assert.equal(yield* generateWith(snakeCaseSchemas, { camelCase: false }), omitted);
    for (const name of snakeNames) assert.match(omitted, new RegExp(`"${name}"`), name);
    assert.doesNotMatch(omitted, /"firstName"/);
  }),
);

it.effect("camelCase rejects two fields that become the same name", () =>
  Effect.gen(function* () {
    const direct = yield* Effect.flip(
      generateWith(
        {
          User: {
            type: "object",
            properties: { user_id: { type: "string" }, userId: { type: "string" } },
          },
        },
        { camelCase: true },
      ),
    );

    assert.ok(direct instanceof SchemaGenerationError);

    assert.equal(
      direct.message,
      "#/components/schemas/User: user_id and userId both become userId",
    );

    const inherited = yield* Effect.flip(
      generateWith(
        {
          Base: { type: "object", properties: { user_id: { type: "string" } } },
          Child: {
            allOf: [
              { $ref: "#/components/schemas/Base" },
              { type: "object", properties: { userId: { type: "string" } } },
            ],
          },
        },
        { camelCase: true },
      ),
    );

    assert.ok(inherited instanceof SchemaGenerationError);

    assert.equal(
      inherited.message,
      "#/components/schemas/Child: user_id and userId both become userId",
    );
  }),
);

it.effect("invalid generator options fail in the typed error channel", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(generateWith(snakeCaseSchemas, { camelCase: "yes" }));
    assert.ok(error instanceof SchemaGenerationError);
    assert.equal(error.message, "#: Invalid generator options");

    assert.equal(
      yield* generateWith(snakeCaseSchemas, { unknown: 1 }),
      yield* generateWith(snakeCaseSchemas, {}),
    );
  }),
);
