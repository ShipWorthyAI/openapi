import { decode } from "@shipworthy/openapi-transformer";
import { NodeServices } from "@effect/platform-node";
import { generate, ModuleLoader } from "@shipworthy/openapi-generator";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { operationRoutes, zod, zodSources, ZodGenerationError, type ZodSource } from "../src/index";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import type { ZodIssue } from "zod";

const document = {
  openapi: "3.1.0",
  info: { title: "Fixture", version: "1" },
  paths: {
    "/items/{id}": {
      post: {
        operationId: "updateItem",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                allOf: [
                  { $ref: "#/components/schemas/Item" },
                  {
                    type: "object",
                    properties: { note: { type: "string", description: "Optional note" } },
                  },
                ],
              },
            },
          },
        },
        responses: { "204": { description: "Updated" } },
      },
    },
    "/items": {
      post: {
        operationId: "createItem",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: { name: { type: "string", minLength: 1 } },
              },
            },
          },
        },
        responses: { "201": { description: "Created" } },
      },
    },
  },
  components: {
    schemas: {
      Item: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1, description: "Display name" },
          email: { type: "string", format: "email" },
          count: { type: "integer", minimum: 0, default: 1 },
        },
      },
    },
  },
};

function sourceFor(schema: Parameters<typeof decode>[0]) {
  const generated = zod.generate(Effect.runSync(decode(schema)), {});
  if (!Effect.isEffect(generated)) return generated;
  return Effect.runSync(generated);
}

async function generateZodSources(source: URL) {
  return Effect.runPromise(
    generate({ specifier: "@shipworthy/openapi-zod", exportName: "zod", source }).pipe(
      Effect.provideService(ModuleLoader, { load: () => import("../src/index.ts") }),
      Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
    ),
  ) as Promise<ZodSource>;
}

async function loadGenerated(source: ZodSource) {
  const directory = await mkdtemp(resolve(import.meta.dirname, ".generation-"));
  await writeFile(resolve(directory, "schema.ts"), source);
  const schemas = await import(pathToFileURL(resolve(directory, "schema.ts")).href);

  return {
    schemas,
    async dispose() {
      await rm(directory, { recursive: true, force: true });
    },
  };
}

void test("component schemas and JSON request bodies parse with Zod", async () => {
  const source = sourceFor(document);
  assert.doesNotMatch(source, /"default"/);

  assert.match(source, /export const Item = z\.compile\(z\.fromJSONSchema\(definitions\.Item\)\)/);

  assert.match(source, /export const updateItemRequestBody/);
  assert.match(source, /#\/\$defs\/Item/);
  assert.match(source, /import type \{ components, operations \} from "\.\/types";/);
  assert.match(source, /as z\.ZodType<components\["schemas"\]\["Item"\]>;/);

  assert.match(
    source,
    /as z\.ZodType<NonNullable<operations\["updateItem"\]\["requestBody"\]>\["content"\]\["application\/json"\]>;/,
  );

  const generated = await loadGenerated(source);

  try {
    assert.deepEqual(generated.schemas.Item.parse({ name: "Hotel" }), { name: "Hotel" });

    assert.deepEqual(
      generated.schemas.Item.parse({ name: "Hotel", email: "desk@hotel.test", count: 2 }),
      {
        name: "Hotel",
        email: "desk@hotel.test",
        count: 2,
      },
    );

    assert.throws(() => generated.schemas.Item.parse({ name: "" }));
    assert.throws(() => generated.schemas.Item.parse({ name: "Hotel", email: "not-an-email" }));
    assert.throws(() => generated.schemas.Item.parse({ name: "Hotel", count: 1.5 }));

    assert.deepEqual(
      generated.schemas.updateItemRequestBody.parse({ name: "Hotel", note: "late" }),
      {
        name: "Hotel",
        note: "late",
      },
    );

    assert.throws(() => generated.schemas.updateItemRequestBody.parse({ note: "late" }));

    assert.deepEqual(generated.schemas.createItemRequestBody.parse({ name: "Hotel" }), {
      name: "Hotel",
    });
  } finally {
    await generated.dispose();
  }
});

void test("required-only allOf branches keep the inherited property", async () => {
  const schema = {
    openapi: "3.1.0",
    info: document.info,
    paths: {},
    components: {
      schemas: {
        Named: {
          allOf: [
            { type: "object", properties: { name: { type: "string" } } },
            { required: ["name"] },
          ],
        },
      },
    },
  };

  const generated = await loadGenerated(sourceFor(schema));

  try {
    assert.deepEqual(generated.schemas.Named.parse({ name: "Hotel" }), { name: "Hotel" });
    assert.throws(() => generated.schemas.Named.parse({}));
  } finally {
    await generated.dispose();
  }
});

void test("not anyOf required forbids those keys", async () => {
  const schema = {
    openapi: "3.1.0",
    info: document.info,
    paths: {},
    components: {
      schemas: {
        Public: {
          allOf: [
            {
              type: "object",
              properties: {
                name: { type: "string" },
                secret: { type: "string" },
              },
            },
            { not: { anyOf: [{ required: ["secret"] }] } },
          ],
        },
      },
    },
  };

  const generated = await loadGenerated(sourceFor(schema));

  try {
    assert.deepEqual(generated.schemas.Public.parse({ name: "Hotel" }), { name: "Hotel" });
    assert.throws(() => generated.schemas.Public.parse({ name: "Hotel", secret: "nope" }));
  } finally {
    await generated.dispose();
  }
});

void test("referenced path items still produce request body validators", async () => {
  const schema = {
    openapi: "3.1.0",
    info: document.info,
    paths: { "/ready": { $ref: "#/components/pathItems/Ready" } },
    components: {
      pathItems: {
        Ready: {
          post: {
            operationId: "ready",
            requestBody: {
              required: true,
              content: { "application/json": { schema: { type: "string", minLength: 1 } } },
            },
            responses: { "204": { description: "OK" } },
          },
        },
      },
    },
  };

  const generated = await loadGenerated(sourceFor(schema));

  try {
    assert.equal(generated.schemas.readyRequestBody.parse("ok"), "ok");
    assert.throws(() => generated.schemas.readyRequestBody.parse(""));
  } finally {
    await generated.dispose();
  }
});

void test("dependentRequired requires the dependencies only when the trigger is present", async () => {
  const schema = {
    openapi: "3.1.0",
    info: document.info,
    paths: {},
    components: {
      schemas: {
        Payment: {
          type: "object",
          dependentRequired: { payment_source_id: ["hold_id"] },
          properties: { hold_id: { type: "string" }, payment_source_id: { type: "string" } },
        },
      },
    },
  };

  const generated = await loadGenerated(sourceFor(schema));

  try {
    assert.deepEqual(generated.schemas.Payment.parse({}), {});
    assert.deepEqual(generated.schemas.Payment.parse({ hold_id: "h" }), { hold_id: "h" });

    assert.deepEqual(generated.schemas.Payment.parse({ hold_id: "h", payment_source_id: "p" }), {
      hold_id: "h",
      payment_source_id: "p",
    });

    assert.throws(() => generated.schemas.Payment.parse({ payment_source_id: "p" }));
  } finally {
    await generated.dispose();
  }
});

void test("discriminator mapping makes overlapping oneOf branches exclusive", async () => {
  const schema = {
    openapi: "3.1.0",
    info: document.info,
    paths: {},
    components: {
      schemas: {
        ProblemResponse: {
          oneOf: [
            { $ref: "#/components/schemas/ProblemInvalidInput" },
            { $ref: "#/components/schemas/ProblemProviderAuthenticationRequired" },
            { $ref: "#/components/schemas/ProblemOther" },
          ],
          discriminator: {
            propertyName: "type",
            mapping: {
              "urn:x:invalid-input": "#/components/schemas/ProblemInvalidInput",
              "urn:x:provider-authentication-required":
                "#/components/schemas/ProblemProviderAuthenticationRequired",
              "urn:x:not-found": "#/components/schemas/ProblemOther",
              "urn:x:conflict": "#/components/schemas/ProblemOther",
            },
          },
        },
        Problem: {
          type: "object",
          required: ["type", "status"],
          properties: { type: { type: "string" }, status: { type: "integer" } },
        },
        ProblemInvalidInput: {
          allOf: [
            { $ref: "#/components/schemas/Problem" },
            {
              type: "object",
              required: ["type"],
              properties: {
                type: { type: "string", enum: ["urn:x:invalid-input"] },
                errors: { type: "array", items: { type: "object" } },
              },
            },
          ],
        },
        ProblemProviderAuthenticationRequired: {
          allOf: [
            { $ref: "#/components/schemas/Problem" },
            {
              type: "object",
              required: ["type", "auth_url"],
              properties: {
                type: { type: "string", enum: ["urn:x:provider-authentication-required"] },
                auth_url: { type: "string", format: "uri" },
              },
            },
          ],
        },
        ProblemOther: {
          allOf: [
            { $ref: "#/components/schemas/Problem" },
            { type: "object", additionalProperties: true },
          ],
        },
      },
    },
  };

  const generated = await loadGenerated(sourceFor(schema));

  try {
    const response = generated.schemas.ProblemResponse;

    assert.deepEqual(response.parse({ type: "urn:x:invalid-input", status: 400, errors: [{}] }), {
      type: "urn:x:invalid-input",
      status: 400,
      errors: [{}],
    });

    assert.deepEqual(
      response.parse({
        type: "urn:x:provider-authentication-required",
        status: 401,
        auth_url: "https://example.com/login",
      }),
      {
        type: "urn:x:provider-authentication-required",
        status: 401,
        auth_url: "https://example.com/login",
      },
    );

    assert.deepEqual(response.parse({ type: "urn:x:not-found", status: 404 }), {
      type: "urn:x:not-found",
      status: 404,
    });

    assert.deepEqual(response.parse({ type: "urn:x:conflict", status: 409 }), {
      type: "urn:x:conflict",
      status: 409,
    });

    assert.throws(() => response.parse({ type: "urn:x:unknown", status: 500 }));

    const missingAuthUrl = response.safeParse({
      type: "urn:x:provider-authentication-required",
      status: 401,
    });

    assert.equal(missingAuthUrl.success, false);
    if (!missingAuthUrl.success)
      assert.deepEqual(
        missingAuthUrl.error.issues.map((issue: ZodIssue) => issue.path),
        [["auth_url"]],
      );

    const invalidErrors = response.safeParse({
      type: "urn:x:invalid-input",
      status: 400,
      errors: [1],
    });

    assert.equal(invalidErrors.success, false);
    if (!invalidErrors.success)
      assert.deepEqual(
        invalidErrors.error.issues.map((issue: ZodIssue) => issue.path),
        [["errors", 0]],
      );

    assert.throws(() =>
      generated.schemas.ProblemOther.parse({ type: "urn:x:invalid-input", status: 400 }),
    );
  } finally {
    await generated.dispose();
  }
});

void test("generation falls back to its own Zod when output has no installed package", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "openapi-zod-resolution-"));

  try {
    const spec = resolve(directory, "openapi.json");
    const output = resolve(directory, "out/schema.ts");
    await writeFile(spec, JSON.stringify(document));

    execFileSync(
      process.execPath,
      [
        resolve(import.meta.dirname, "../../openapi-cli/src/bin.ts"),
        "generate",
        "zod",
        spec,
        "-o",
        output,
      ],
      { cwd: resolve(import.meta.dirname, "../../.."), encoding: "utf8" },
    );

    assert.match(readFileSync(output, "utf8"), /export const Item/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("generation resolves Zod from the output package before the generator", async () => {
  const directory = await mkdtemp(resolve(import.meta.dirname, ".resolution-"));
  const generator = resolve(directory, "generator");
  const output = resolve(directory, "sdk");
  const outputPath = resolve(output, "validators.ts");
  const wrongOutput = resolve(directory, "sdk-wrong");
  const wrongOutputPath = resolve(wrongOutput, "validators.ts");
  const realZod = dirname(createRequire(import.meta.url).resolve("zod/package.json"));

  try {
    await cp(resolve(import.meta.dirname, "../src"), resolve(generator, "src"), {
      recursive: true,
    });

    await mkdir(resolve(generator, "node_modules/zod"), { recursive: true });
    await mkdir(resolve(output, "node_modules"), { recursive: true });
    await mkdir(resolve(wrongOutput, "node_modules/zod"), { recursive: true });

    await writeFile(
      resolve(generator, "node_modules/zod/package.json"),
      JSON.stringify({ name: "zod", version: "3.25.76", main: "index.cjs" }),
    );

    await writeFile(resolve(generator, "node_modules/zod/index.cjs"), "module.exports = {};\n");
    await symlink(realZod, resolve(output, "node_modules/zod"));

    await writeFile(
      resolve(wrongOutput, "node_modules/zod/package.json"),
      JSON.stringify({ name: "zod", version: "3.25.76", main: "index.cjs" }),
    );

    await writeFile(resolve(wrongOutput, "node_modules/zod/index.cjs"), "module.exports = {};\n");

    const copied: typeof import("../src/index.ts") = await import(
      pathToFileURL(resolve(generator, "src/index.ts")).href
    );

    const model = Effect.runSync(decode(document));
    const generated = copied.zod.generate(model, { outputPath });
    const source = Effect.isEffect(generated) ? Effect.runSync(generated) : generated;
    assert.match(source, /export const Item =/);

    const wrong = copied.zod.generate(model, { outputPath: wrongOutputPath });
    assert(Effect.isEffect(wrong));

    assert.throws(
      () => Effect.runSync(wrong),
      /#: Found zod@3\.25\.76 at .*sdk-wrong\/node_modules\/zod\/package\.json \(resolved from .*validators\.ts\); require zod@4\.6\.5/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("an import-only Zod at the output location cannot be bypassed", async () => {
  const directory = await mkdtemp(resolve(import.meta.dirname, ".resolution-"));
  const outputPath = resolve(directory, "sdk/validators.ts");
  const packageDirectory = resolve(directory, "sdk/node_modules/zod");

  try {
    await mkdir(packageDirectory, { recursive: true });

    await writeFile(
      resolve(packageDirectory, "package.json"),
      JSON.stringify({
        name: "zod",
        version: "3.25.76",
        type: "module",
        exports: { ".": { import: "./index.js" } },
      }),
    );

    await writeFile(resolve(packageDirectory, "index.js"), "export const marker = 123;\n");

    const generated = zod.generate(Effect.runSync(decode(document)), { outputPath });
    assert(Effect.isEffect(generated));

    assert.throws(
      () => Effect.runSync(generated),
      /#: Found zod@3\.25\.76 at .*sdk\/node_modules\/zod\/package\.json .*require zod@4\.6\.5/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("a malformed Zod import entry fails in the typed error channel", async () => {
  const directory = await mkdtemp(resolve(import.meta.dirname, ".resolution-"));
  const outputPath = resolve(directory, "sdk/validators.ts");
  const packageDirectory = resolve(directory, "sdk/node_modules/zod");

  try {
    await mkdir(packageDirectory, { recursive: true });

    await writeFile(
      resolve(packageDirectory, "package.json"),
      JSON.stringify({
        name: "zod",
        version: "4.6.5",
        type: "module",
        exports: { ".": { import: "./%2F" } },
      }),
    );

    const generated = zod.generate(Effect.runSync(decode(document)), { outputPath });
    assert(Effect.isEffect(generated));
    const error = Effect.runSync(Effect.flip(generated));
    assert.equal(error._tag, "ZodGenerationError");
    assert.match(error.message, /^#: Cannot resolve zod import entry/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("discriminator infers ref names without mapping and constrains anyOf", async () => {
  const schema = {
    openapi: "3.1.0",
    info: document.info,
    paths: {},
    components: {
      schemas: {
        Result: {
          anyOf: [{ $ref: "#/components/schemas/Good" }, { $ref: "#/components/schemas/Other" }],
          discriminator: { propertyName: "kind" },
        },
        Good: { type: "object", required: ["value"], properties: { value: { type: "integer" } } },
        Other: { type: "object", additionalProperties: true },
      },
    },
  };

  const generated = await loadGenerated(sourceFor(schema));

  try {
    assert.deepEqual(generated.schemas.Result.parse({ kind: "Good", value: 1 }), {
      kind: "Good",
      value: 1,
    });

    assert.deepEqual(generated.schemas.Result.parse({ kind: "Other", value: "anything" }), {
      kind: "Other",
      value: "anything",
    });

    assert.throws(() => generated.schemas.Result.parse({ kind: "Unknown", value: 1 }));
    assert.throws(() => generated.schemas.Result.parse({ kind: "Good", value: "wrong" }));
  } finally {
    await generated.dispose();
  }
});

void test("inline request discriminators constrain exported component validators", async () => {
  const schema = {
    openapi: "3.1.0",
    info: document.info,
    paths: {
      "/events": {
        post: {
          operationId: "createEvent",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    { $ref: "#/components/schemas/Good" },
                    { $ref: "#/components/schemas/Other" },
                  ],
                  discriminator: {
                    propertyName: "kind",
                    mapping: {
                      good: "#/components/schemas/Good",
                      other: "#/components/schemas/Other",
                    },
                  },
                },
              },
            },
          },
          responses: { "204": { description: "OK" } },
        },
      },
    },
    components: {
      schemas: {
        Good: {
          type: "object",
          required: ["value"],
          properties: { value: { type: "integer" } },
        },
        Other: { type: "object", additionalProperties: true },
      },
    },
  };

  const generated = await loadGenerated(sourceFor(schema));

  try {
    assert.deepEqual(generated.schemas.Good.parse({ kind: "good", value: 1 }), {
      kind: "good",
      value: 1,
    });

    assert.throws(() => generated.schemas.Good.parse({ value: 1 }));
    assert.throws(() => generated.schemas.Good.parse({ kind: "other", value: 1 }));
    assert.throws(() => generated.schemas.Other.parse({ kind: "good", value: 1 }));

    assert.deepEqual(generated.schemas.createEventRequestBody.parse({ kind: "good", value: 1 }), {
      kind: "good",
      value: 1,
    });
  } finally {
    await generated.dispose();
  }
});

void test("a component reused by discriminated unions accepts each mapped value", async () => {
  const schema = {
    openapi: "3.1.0",
    info: document.info,
    paths: {},
    components: {
      schemas: {
        First: {
          oneOf: [{ $ref: "#/components/schemas/Shared" }],
          discriminator: {
            propertyName: "kind",
            mapping: { first: "#/components/schemas/Shared" },
          },
        },
        Second: {
          oneOf: [{ $ref: "#/components/schemas/Shared" }],
          discriminator: {
            propertyName: "kind",
            mapping: { second: "#/components/schemas/Shared" },
          },
        },
        Shared: { type: "object", additionalProperties: true },
      },
    },
  };

  const generated = await loadGenerated(sourceFor(schema));

  try {
    assert.deepEqual(generated.schemas.First.parse({ kind: "first" }), { kind: "first" });
    assert.deepEqual(generated.schemas.Second.parse({ kind: "second" }), { kind: "second" });
    assert.deepEqual(generated.schemas.Shared.parse({ kind: "first" }), { kind: "first" });
    assert.deepEqual(generated.schemas.Shared.parse({ kind: "second" }), { kind: "second" });
    assert.throws(() => generated.schemas.Shared.parse({ kind: "unknown" }));
  } finally {
    await generated.dispose();
  }
});

void test("a component reused under different discriminator properties keeps each union usable", async () => {
  const schema = {
    openapi: "3.1.0",
    info: document.info,
    paths: {},
    components: {
      schemas: {
        ByKind: {
          oneOf: [{ $ref: "#/components/schemas/Shared" }],
          discriminator: {
            propertyName: "kind",
            mapping: { byKind: "#/components/schemas/Shared" },
          },
        },
        ByCategory: {
          oneOf: [{ $ref: "#/components/schemas/Shared" }],
          discriminator: {
            propertyName: "category",
            mapping: { byCategory: "#/components/schemas/Shared" },
          },
        },
        Shared: { type: "object", additionalProperties: true },
      },
    },
  };

  const generated = await loadGenerated(sourceFor(schema));

  try {
    assert.deepEqual(generated.schemas.ByKind.parse({ kind: "byKind" }), { kind: "byKind" });

    assert.deepEqual(generated.schemas.ByCategory.parse({ category: "byCategory" }), {
      category: "byCategory",
    });

    assert.throws(() => generated.schemas.ByKind.parse({ category: "byCategory" }));
    assert.throws(() => generated.schemas.ByCategory.parse({ kind: "byKind" }));
    assert.deepEqual(generated.schemas.Shared.parse({ kind: "byKind" }), { kind: "byKind" });

    assert.deepEqual(generated.schemas.Shared.parse({ category: "byCategory" }), {
      category: "byCategory",
    });
  } finally {
    await generated.dispose();
  }
});

void test("an explicit mapping cannot claim another branch's implicit name", () => {
  const schema = {
    openapi: "3.1.0",
    info: document.info,
    paths: {},
    components: {
      schemas: {
        Result: {
          oneOf: [{ $ref: "#/components/schemas/Foo" }, { $ref: "#/components/schemas/Other" }],
          discriminator: {
            propertyName: "kind",
            mapping: { Foo: "#/components/schemas/Other" },
          },
        },
        Foo: { type: "object", additionalProperties: true },
        Other: { type: "object", additionalProperties: true },
      },
    },
  };

  assert.throws(
    () => sourceFor(schema),
    /#\/components\/schemas\/Result\/oneOf\/0: Discriminator branch has no unique value/,
  );
});

void test("discriminator mapping preserves an existing property constraint", async () => {
  const schema = {
    openapi: "3.1.0",
    info: document.info,
    paths: {},
    components: {
      schemas: {
        Result: {
          oneOf: [{ $ref: "#/components/schemas/Child" }],
          discriminator: {
            propertyName: "kind",
            mapping: { bad: "#/components/schemas/Child" },
          },
        },
        Child: {
          type: "object",
          required: ["kind"],
          properties: { kind: { type: "string", pattern: "^ok$" } },
        },
      },
    },
  };

  const generated = await loadGenerated(sourceFor(schema));

  try {
    assert.throws(() => generated.schemas.Child.parse({ kind: "bad" }));
    assert.throws(() => generated.schemas.Result.parse({ kind: "bad" }));
  } finally {
    await generated.dispose();
  }
});

void test("inline response discriminators constrain exported component validators", async () => {
  const schema = {
    openapi: "3.1.0",
    info: document.info,
    paths: {
      "/events": {
        get: {
          operationId: "getEvent",
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    oneOf: [
                      { $ref: "#/components/schemas/Good" },
                      { $ref: "#/components/schemas/Other" },
                    ],
                    discriminator: {
                      propertyName: "kind",
                      mapping: {
                        good: "#/components/schemas/Good",
                        other: "#/components/schemas/Other",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Good: { type: "object", properties: { kind: { type: "string" } } },
        Other: { type: "object", additionalProperties: true },
      },
    },
  };

  const generated = await loadGenerated(sourceFor(schema));

  try {
    assert.deepEqual(generated.schemas.Good.parse({ kind: "good" }), { kind: "good" });
    assert.throws(() => generated.schemas.Good.parse({ kind: "other" }));
    assert.throws(() => generated.schemas.Good.parse({}));
    assert.throws(() => generated.schemas.Other.parse({ kind: "good" }));
  } finally {
    await generated.dispose();
  }
});

void test("an ungenerated response can contain inline discriminator branches", async () => {
  const schema = {
    openapi: "3.1.0",
    info: document.info,
    paths: {
      "/events": {
        get: {
          operationId: "getEvent",
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    oneOf: [
                      { $ref: "#/components/schemas/Good" },
                      {
                        type: "object",
                        properties: { kind: { type: "string", const: "inline" } },
                      },
                    ],
                    discriminator: {
                      propertyName: "kind",
                      mapping: { good: "#/components/schemas/Good" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Good: { type: "object", properties: { kind: { type: "string" } } },
      },
    },
  };

  const generated = await loadGenerated(sourceFor(schema));

  try {
    assert.deepEqual(generated.schemas.Good.parse({ kind: "good" }), { kind: "good" });
    assert.throws(() => generated.schemas.Good.parse({ kind: "inline" }));
  } finally {
    await generated.dispose();
  }
});

void test("parameter discriminators constrain exported component validators", async () => {
  const schema = {
    openapi: "3.1.0",
    info: document.info,
    paths: {
      "/events": {
        get: {
          operationId: "listEvents",
          parameters: [
            {
              name: "filter",
              in: "query" as const,
              schema: {
                oneOf: [
                  { $ref: "#/components/schemas/Good" },
                  { $ref: "#/components/schemas/Other" },
                ],
                discriminator: {
                  propertyName: "kind",
                  mapping: {
                    good: "#/components/schemas/Good",
                    other: "#/components/schemas/Other",
                  },
                },
              },
            },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
    },
    components: {
      schemas: {
        Good: { type: "object", properties: { kind: { type: "string" } } },
        Other: { type: "object", additionalProperties: true },
      },
    },
  };

  const generated = await loadGenerated(sourceFor(schema));

  try {
    assert.deepEqual(generated.schemas.Good.parse({ kind: "good" }), { kind: "good" });
    assert.throws(() => generated.schemas.Good.parse({ kind: "other" }));
    assert.throws(() => generated.schemas.Other.parse({ kind: "good" }));
  } finally {
    await generated.dispose();
  }
});

void test("children extending a discriminator parent receive mapped or implicit values", async () => {
  const schema = {
    openapi: "3.1.0",
    info: document.info,
    paths: {},
    components: {
      schemas: {
        Event: {
          type: "object",
          required: ["kind"],
          properties: { kind: { type: "string" } },
          discriminator: {
            propertyName: "kind",
            mapping: {
              received: "#/components/schemas/Created",
              accepted: "#/components/schemas/Created",
            },
          },
        },
        Created: { allOf: [{ $ref: "#/components/schemas/Event" }] },
        Deleted: { allOf: [{ $ref: "#/components/schemas/Event" }] },
      },
    },
  };

  const generated = await loadGenerated(sourceFor(schema));

  try {
    assert.deepEqual(generated.schemas.Created.parse({ kind: "received" }), {
      kind: "received",
    });

    assert.deepEqual(generated.schemas.Created.parse({ kind: "accepted" }), {
      kind: "accepted",
    });

    assert.throws(() => generated.schemas.Created.parse({ kind: "Deleted" }));

    assert.deepEqual(generated.schemas.Deleted.parse({ kind: "Deleted" }), {
      kind: "Deleted",
    });

    assert.throws(() => generated.schemas.Deleted.parse({ kind: "other" }));
  } finally {
    await generated.dispose();
  }
});

void test("external schema refs are bundled before conversion", async () => {
  const directory = await mkdtemp(resolve(import.meta.dirname, ".generation-"));

  const schema = {
    openapi: "3.1.0",
    info: { title: "External", version: "1" },
    paths: {},
    components: { schemas: { Item: { $ref: "./item.json" } } },
  };

  await writeFile(resolve(directory, "schema.json"), JSON.stringify(schema));

  await writeFile(
    resolve(directory, "item.json"),
    JSON.stringify({
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
    }),
  );

  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    const file = req.url?.endsWith("/item.json") ? "item.json" : "schema.json";
    res.end(readFileSync(resolve(directory, file)));
  });

  await new Promise<void>((listen) => server.listen(0, "127.0.0.1", listen));

  try {
    const local = await generateZodSources(pathToFileURL(resolve(directory, "schema.json")));

    const address = server.address();
    assert.ok(address && typeof address !== "string");

    const remote = await generateZodSources(
      new URL(`http://127.0.0.1:${address.port}/schema.json`),
    );

    const generated = await loadGenerated(local);

    try {
      assert.deepEqual(generated.schemas.Item.parse({ name: "Hotel" }), { name: "Hotel" });
      assert.match(remote, /export const Item/);
    } finally {
      await generated.dispose();
    }
  } finally {
    await new Promise<void>((close, reject) =>
      server.close((error) => (error ? reject(error) : close())),
    );

    await rm(directory, { recursive: true, force: true });
  }
});

void test("unsupported documents and schemas fail before files are written", () => {
  const base = structuredClone(document);

  assert.throws(
    () => sourceFor({ ...base, jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema" }),
    /custom dialects or top-level \$defs/,
  );

  assert.throws(() => sourceFor({ ...base, $defs: { Extra: { type: "string" } } }), /\$defs/);

  const keyword = structuredClone(document) as any;
  keyword.components.schemas.Item.if = { type: "object" };
  assert.throws(() => sourceFor(keyword), /Unsupported keyword if/);

  const sibling = structuredClone(document) as any;
  sibling.components.schemas.Wrapper = { $ref: "#/components/schemas/Item", type: "object" };
  assert.throws(() => sourceFor(sibling), /alongside \$ref/);

  const externalRef = structuredClone(document) as any;

  externalRef.components.parameters = {
    Id: { name: "id", in: "path", required: true, schema: { type: "string" } },
  };

  externalRef.components.schemas.Item = { $ref: "#/components/parameters/Id" };
  assert.throws(() => sourceFor(externalRef), /Unsupported schema reference/);

  const media = structuredClone(document) as any;
  media.paths["/items"].post.requestBody.content["text/plain"] = { schema: { type: "string" } };
  assert.throws(() => sourceFor(media), /single application\/json media type/);

  const missingSchema = structuredClone(document) as any;
  delete missingSchema.paths["/items"].post.requestBody.content["application/json"].schema;
  assert.throws(() => sourceFor(missingSchema), /Request body has no schema/);

  const missingId = structuredClone(document) as any;
  delete missingId.paths["/items"].post.operationId;
  assert.throws(() => sourceFor(missingId), /POST \/items: Missing operationId/);

  const duplicate = structuredClone(document) as any;
  duplicate.paths["/items"].post.operationId = "updateItem";
  assert.throws(() => sourceFor(duplicate), /Duplicate operationId: updateItem/);

  const badName = structuredClone(document) as any;
  badName.components.schemas["not-a-name"] = { type: "string" };
  assert.throws(() => sourceFor(badName), /Cannot emit this name as a schema export/);

  const collision = structuredClone(document) as any;
  collision.components.schemas.createItemRequestBody = { type: "string" };
  assert.throws(() => sourceFor(collision), /createItemRequestBody: Duplicate schema export/);

  const untyped = structuredClone(document) as any;
  untyped.components.schemas.Item = { minLength: 1 };
  assert.throws(() => sourceFor(untyped), /Constraints without a type/);

  const tuple = structuredClone(document) as any;
  tuple.components.schemas.Item = { type: "array", items: [{ type: "string" }] };
  assert.throws(() => sourceFor(tuple), /Tuple items require prefixItems/);
});

void test("nested validation failures are recoverable and stop at the first schema", () => {
  const model = Effect.runSync(
    decode({
      openapi: "3.1.0",
      info: document.info,
      paths: {},
      components: {
        schemas: {
          First: { type: "object", properties: { value: { type: "string", if: {} } } },
          Second: { discriminator: { propertyName: "kind" } },
        },
      },
    }),
  );

  const message = Effect.runSync(
    zodSources(model, {}).pipe(
      Effect.catchTag("ZodGenerationError", (error) => Effect.succeed(error.message)),
    ),
  );

  assert.equal(message, "#/components/schemas/First/properties/value: Unsupported keyword if");
});

void test("reference and keyword decoding failures stay in the typed error channel", () => {
  const failureFor = (schema: Parameters<typeof decode>[0]) => {
    const model = Effect.runSync(decode(schema));
    return Effect.runSync(Effect.flip(zodSources(model, {})));
  };

  const unresolved = failureFor({
    openapi: "3.1.0",
    info: document.info,
    paths: {},
    components: { schemas: { Missing: { $ref: "#/components/schemas/Absent" } } },
  });

  assert.ok(unresolved instanceof ZodGenerationError);
  assert.equal(unresolved.message, "#/components/schemas/Absent: Unresolved reference");

  const malformed = failureFor({
    openapi: "3.1.0",
    info: document.info,
    paths: {},
    components: { schemas: { Bad: { type: "object", properties: { field: 1 } } } },
  });

  assert.ok(malformed instanceof ZodGenerationError);

  assert.equal(
    malformed.message,
    "#/components/schemas/Bad/properties/field: Expected a JSON schema",
  );
});

void test("Zod conversion failures preserve the export name and original cause", () => {
  const model = Effect.runSync(
    decode({
      openapi: "3.1.0",
      info: document.info,
      paths: {},
      components: { schemas: { Broken: { type: "string", pattern: "[" } } },
    }),
  );

  const failure = Effect.runSync(Effect.flip(zodSources(model, {})));
  assert.ok(failure instanceof ZodGenerationError);
  assert.match(failure.message, /^Broken: /);
  assert.ok(failure.cause instanceof SyntaxError);
});

void test("generation and route effects can be rerun without retaining traversal state", async () => {
  const model = Effect.runSync(
    decode({
      ...document,
      components: {
        schemas: {
          Anything: true,
          Nothing: false,
          Node: {
            type: "object",
            properties: {
              next: { $ref: "#/components/schemas/Node" },
              value: { $ref: "#/components/schemas/Anything" },
              forbidden: { $ref: "#/components/schemas/Nothing" },
            },
          },
          Item: document.components.schemas.Item,
        },
      },
    }),
  );

  const original = structuredClone(model);
  const routeEffect = operationRoutes(model);
  const firstRoutes = Effect.runSync(routeEffect);
  const secondRoutes = Effect.runSync(routeEffect);
  assert.notEqual(firstRoutes, secondRoutes);
  assert.deepEqual(firstRoutes, secondRoutes);
  assert.equal(Object.getPrototypeOf(secondRoutes), null);

  const generation = zodSources(model, firstRoutes);
  const firstSource = Effect.runSync(generation);
  assert.equal(Effect.runSync(generation), firstSource);
  assert.deepEqual(model, original);
  const generated = await loadGenerated(firstSource);

  try {
    assert.deepEqual(generated.schemas.Node.parse({ next: { value: 42 } }), {
      next: { value: 42 },
    });

    assert.throws(() => generated.schemas.Node.parse({ forbidden: 42 }));
    assert.equal(generated.schemas.Anything.parse(42), 42);
    assert.throws(() => generated.schemas.Nothing.parse(42));
  } finally {
    await generated.dispose();
  }
});
