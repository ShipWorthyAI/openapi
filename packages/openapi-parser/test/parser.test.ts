import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { JsonPointer } from "effect";
import { describe, expect, it } from "vitest";
import {
  bundle,
  dereference,
  InvalidPointerError,
  JSONParserErrorGroup,
  MissingPointerError,
  parse,
  ResolverError,
  TimeoutError,
  type FileInfo,
} from "../src/index.js";
import { joinPointer, parsePointer } from "../src/pointer.js";

const openapiRoot = path.resolve(import.meta.dirname, "fixtures/bundle-openapi/root.yaml");

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "openapi-parser-"));
}

describe("json pointer", () => {
  it("keeps $ literal and decodes ~0 and ~1", () => {
    expect(joinPointer("#/components/schemas", "$defs")).toBe("#/components/schemas/$defs");
    expect(joinPointer("#", ["a/b", "c~d"])).toBe("#/a~1b/c~0d");
    expect(parsePointer("#/a~1b/c~0d")).toEqual(["a/b", "c~d"]);
    expect(JsonPointer.escapeToken("$ref")).toBe("$ref");
  });
});

describe("openapi bundle", () => {
  it("parses YAML and hoists external component files", async () => {
    const bundled = (await bundle(openapiRoot)) as {
      openapi: string;
      paths: Record<string, any>;
      components: Record<string, any>;
    };

    expect(bundled.openapi).toBe("3.1.0");
    expect(bundled.paths["/pets"].get.parameters[0].$ref).toBe("#/components/parameters/limit");

    expect(bundled.components.parameters.limit).toEqual({
      name: "limit",
      in: "query",
      schema: { type: "integer" },
    });

    expect(bundled.paths["/pets"].get.responses["201"].$ref).toBe("#/components/responses/created");
    expect(bundled.components.responses.created.description).toBe("created");

    expect(bundled.paths["/pets"].post.requestBody.$ref).toBe(
      "#/components/requestBodies/pet-body",
    );

    expect(bundled.components.requestBodies["pet-body"].required).toBe(true);

    expect(bundled.paths["/pets"].get.responses["200"].headers["X-Rate"].$ref).toBe(
      "#/components/headers/rate",
    );

    expect(bundled.components.headers.rate.schema).toEqual({ type: "integer" });

    expect(
      bundled.paths["/pets"].get.responses["200"].content["application/json"].schema.$ref,
    ).toBe("#/components/schemas/pet");

    expect(bundled.components.schemas.pet.properties.owner.$ref).toBe("#/components/schemas/owner");
    expect(bundled.components.schemas.owner.properties.id).toEqual({ type: "string" });

    expect(
      bundled.paths["/pets"].put.responses["200"].content["application/json"].schema.$ref,
    ).toBe("#/components/schemas/pet-2");

    expect(bundled.components.schemas["pet-2"].properties.sku).toEqual({ type: "string" });

    expect(
      bundled.paths["/pets"].get.responses["200"].content["application/json"].examples.sample.$ref,
    ).toBe("#/components/examples/pet-example");

    expect(bundled.components.examples["pet-example"].value).toEqual({ name: "Rex" });

    expect(bundled.paths["/pets"].post.responses["200"].links.next.$ref).toBe(
      "#/components/links/pet-link",
    );

    expect(bundled.components.links["pet-link"].operationId).toBe("getPet");

    expect(bundled.paths["/pets"].post.callbacks.onPet.$ref).toBe(
      "#/components/callbacks/pet-callback",
    );

    expect(bundled.components.securitySchemes.ApiKey).toEqual({
      type: "apiKey",
      name: "X-Api-Key",
      in: "header",
    });

    expect(
      bundled.paths["/pets"].post.responses["200"].content["application/json"].schema.$ref,
    ).toBe("#/components/schemas/Local");

    expect(bundled.components.schemas.Local).toEqual({ type: "string" });
  });

  it("loads each external URL once", async () => {
    let reads = 0;
    const directory = await tempDir();

    const root = {
      openapi: "3.1.0",
      info: { title: "Cache", version: "1" },
      paths: {},
      components: {
        schemas: {
          A: { $ref: "./item.json" },
          B: { $ref: "./item.json" },
        },
      },
    };

    await writeFile(path.join(directory, "root.json"), JSON.stringify(root));

    await writeFile(
      path.join(directory, "item.json"),
      JSON.stringify({ type: "object", properties: { name: { type: "string" } } }),
    );

    const bundled = (await bundle(path.join(directory, "root.json"), {
      resolvers: [
        {
          order: 0,
          canRead: (file: FileInfo) => file.url.includes("item.json"),
          read: () => {
            reads += 1;
            return JSON.stringify({ type: "object", properties: { name: { type: "string" } } });
          },
        },
      ],
    })) as { components: { schemas: Record<string, { $ref?: string; type?: string }> } };

    expect(reads).toBe(1);
    expect(bundled.components.schemas["A"]?.type).toBe("object");
    expect(bundled.components.schemas["B"]?.$ref).toBe("#/components/schemas/A");
  });

  it("falls through resolvers until one succeeds", async () => {
    const schema = await parse("mem://root.json", {
      resolve: { file: false, http: false },
      resolvers: [
        {
          canRead: () => true,
          read: () => Promise.reject(new Error("first failed")),
        },
        {
          canRead: () => true,
          read: () =>
            JSON.stringify({
              openapi: "3.1.0",
              info: { title: "Fallback", version: "1" },
              paths: {},
            }),
        },
      ],
    });

    expect(schema).toMatchObject({ info: { title: "Fallback" } });
  });

  it("upgrades OpenAPI 3.0 schemas to 3.1", async () => {
    const bundled = (await bundle({
      openapi: "3.0.4",
      info: { title: "Upgrade", version: "1" },
      paths: {
        "/search": {
          get: {
            parameters: [
              {
                name: "q",
                in: "query",
                example: "keep-me",
                schema: { type: "string", nullable: true, example: "schema-example" },
              },
            ],
            responses: { "204": { description: "empty" } },
          },
        },
      },
      components: {
        schemas: {
          Age: { type: "integer", minimum: 0, exclusiveMinimum: true },
          Pair: {
            type: "array",
            items: [{ type: "string" }, { type: "number" }],
            additionalItems: false,
          },
          Wrapped: { $ref: "#/components/schemas/Age", description: "kept" },
        },
      },
    })) as any;

    expect(bundled.openapi).toBe("3.1.0");
    expect(bundled.paths["/search"].get.parameters[0].example).toBe("keep-me");

    expect(bundled.paths["/search"].get.parameters[0].schema).toEqual({
      type: ["string", "null"],
      examples: ["schema-example"],
    });

    expect(bundled.components.schemas.Age).toEqual({ type: "integer", exclusiveMinimum: 0 });

    expect(bundled.components.schemas.Pair.prefixItems).toEqual([
      { type: "string" },
      { type: "number" },
    ]);

    expect(bundled.components.schemas.Pair.items).toBe(false);
    expect(bundled.components.schemas.Pair.additionalItems).toBeUndefined();

    expect(bundled.components.schemas.Wrapped).toEqual({
      allOf: [{ $ref: "#/components/schemas/Age" }, { description: "kept" }],
    });
  });

  it("leaves no OpenAPI 3.0 nullable behind", async () => {
    const bundled = (await bundle({
      openapi: "3.0.3",
      info: { title: "Nullable", version: "1" },
      paths: {},
      components: {
        schemas: {
          Pet: { type: "object", properties: { name: { type: "string" } } },
          Color: { type: "string", enum: ["red"], nullable: true },
          Owner: { $ref: "#/components/schemas/Pet", nullable: true },
          Partner: {
            description: "Either one",
            nullable: true,
            allOf: [{ $ref: "#/components/schemas/Pet" }],
          },
          Filter: {
            type: "object",
            nullable: true,
            properties: { name: { type: "string" } },
            anyOf: [{ required: ["name"] }],
          },
        },
      },
    })) as any;

    const schemas = bundled.components.schemas;

    expect(JSON.stringify(schemas)).not.toContain("nullable");
    expect(schemas.Color).toEqual({ type: ["string", "null"], enum: ["red", null] });

    expect(schemas.Owner).toEqual({
      anyOf: [{ $ref: "#/components/schemas/Pet" }, { type: "null" }],
    });

    expect(schemas.Partner).toEqual({
      description: "Either one",
      anyOf: [{ allOf: [{ $ref: "#/components/schemas/Pet" }] }, { type: "null" }],
    });

    expect(schemas.Filter.anyOf[1]).toEqual({ type: "null" });
    expect(schemas.Filter.anyOf[0].type).toBe("object");
  });

  it("keeps recursive schemas as $refs and inlines the others when dereferencing", async () => {
    const document = {
      openapi: "3.1.0",
      info: { title: "Cycle", version: "1" },
      paths: {},
      components: {
        schemas: {
          Node: {
            type: "object",
            properties: {
              child: { $ref: "#/components/schemas/Node" },
              label: { $ref: "#/components/schemas/Label" },
            },
          },
          Label: { type: "string" },
          A: {
            type: "object",
            properties: { b: { $ref: "#/components/schemas/B" } },
          },
          B: {
            type: "object",
            properties: { a: { $ref: "#/components/schemas/A" } },
          },
        },
      },
    };

    const bundled = (await bundle(structuredClone(document))) as any;
    expect(bundled.components.schemas.Node.properties.child.$ref).toBe("#/components/schemas/Node");

    expect(bundled.components.schemas.Node.properties.label.$ref).toBe(
      "#/components/schemas/Label",
    );

    const dereferenced = (await dereference(structuredClone(document))) as any;
    expect(JSON.stringify(dereferenced)).toContain("#/components/schemas/Node");

    expect(dereferenced.components.schemas.Node.properties.child.$ref).toBe(
      "#/components/schemas/Node",
    );

    expect(dereferenced.components.schemas.Node.properties.label).toEqual({ type: "string" });
    expect(dereferenced.components.schemas.A.properties.b.$ref).toBe("#/components/schemas/B");
    expect(dereferenced.components.schemas.B.properties.a.$ref).toBe("#/components/schemas/A");
  });

  it("rejects a circular alias", async () => {
    await expect(
      bundle({
        openapi: "3.1.0",
        info: { title: "Alias", version: "1" },
        paths: {},
        components: {
          schemas: {
            A: { $ref: "#/components/schemas/B" },
            B: { $ref: "#/components/schemas/A" },
          },
        },
      }),
    ).rejects.toThrow(/circular alias/);
  });

  it("resolves an absolute $id back into the definition pool", async () => {
    const bundled = (await bundle({
      openapi: "3.1.0",
      info: { title: "Id", version: "1" },
      paths: {},
      components: {
        schemas: {
          Tree: {
            $id: "https://example.com/tree",
            type: "object",
            properties: {
              left: { $ref: "https://example.com/tree" },
              label: { $ref: "https://example.com/tree#/$defs/Label" },
            },
            $defs: { Label: { type: "string" } },
          },
        },
      },
    })) as any;

    expect(bundled.components.schemas.Tree.properties.left.$ref).toBe("#/components/schemas/Tree");
    expect(bundled.components.schemas.Tree.$defs).toBeUndefined();
    expect(bundled.components.schemas.Label).toEqual({ type: "string" });

    expect(bundled.components.schemas.Tree.properties.label.$ref).toBe(
      "#/components/schemas/Label",
    );
  });

  it("rewrites discriminator mappings and inlines external values", async () => {
    const directory = await tempDir();

    await writeFile(
      path.join(directory, "dog.json"),
      JSON.stringify({ type: "object", properties: { bark: { type: "boolean" } } }),
    );

    await writeFile(path.join(directory, "sample.json"), JSON.stringify({ name: "Rex" }));

    const root = {
      openapi: "3.1.0",
      info: { title: "Pets", version: "1" },
      paths: {},
      components: {
        schemas: {
          Pet: {
            oneOf: [{ $ref: "#/components/schemas/Cat" }, { $ref: "./dog.json" }],
            discriminator: {
              propertyName: "petType",
              mapping: {
                cat: "#/components/schemas/Cat",
                dog: "./dog.json",
              },
            },
          },
          Cat: { type: "object", properties: { meow: { type: "boolean" } } },
        },
        examples: {
          sample: { externalValue: "./sample.json" },
        },
      },
    };

    const bundled = (await bundle(path.join(directory, "root.json"), root)) as any;

    expect(bundled.components.schemas.Pet.discriminator.mapping.dog).toBe(
      "#/components/schemas/dog",
    );

    expect(bundled.components.schemas.Pet.oneOf[1].$ref).toBe("#/components/schemas/dog");
    expect(bundled.components.examples.sample).toEqual({ value: { name: "Rex" } });
  });

  it("leaves absolute http refs and external values when keepUrlRefs is set", async () => {
    const directory = await tempDir();
    await writeFile(path.join(directory, "local.json"), JSON.stringify({ type: "string" }));

    const bundled = (await bundle(
      path.join(directory, "root.json"),
      {
        openapi: "3.1.0",
        info: { title: "Remote", version: "1" },
        paths: {},
        components: {
          schemas: {
            Local: { $ref: "./local.json" },
            Remote: { $ref: "https://example.com/remote.json" },
          },
          examples: {
            remote: { externalValue: "https://example.com/sample.json" },
          },
        },
      },
      { keepUrlRefs: true },
    )) as any;

    expect(bundled.components.schemas.Local).toEqual({ type: "string" });
    expect(bundled.components.schemas.Remote.$ref).toBe("https://example.com/remote.json");

    expect(bundled.components.examples.remote.externalValue).toBe(
      "https://example.com/sample.json",
    );
  });

  it("dereferences a plain YAML document the way config loading does", async () => {
    const directory = await tempDir();
    await writeFile(path.join(directory, "extra.yaml"), "name: extra\n");

    await writeFile(
      path.join(directory, "shipworthy.yaml"),
      "apis:\n  main:\n    root: ./openapi.yaml\n    meta:\n      $ref: ./extra.yaml\n",
    );

    const config = (await dereference(path.join(directory, "shipworthy.yaml"))) as {
      apis: { main: { root: string; meta: { name: string } } };
    };

    expect(config.apis.main.root).toBe("./openapi.yaml");
    expect(config.apis.main.meta).toEqual({ name: "extra" });
  });

  it("reuses an existing component name for the same external file", async () => {
    const directory = await tempDir();
    await writeFile(path.join(directory, "unauthorized.yaml"), "description: no\n");

    await writeFile(
      path.join(directory, "root.yaml"),
      [
        "openapi: 3.1.0",
        "info: { title: Names, version: '1' }",
        "paths:",
        "  /pets:",
        "    get:",
        "      responses:",
        "        '401':",
        "          $ref: ./unauthorized.yaml",
        "components:",
        "  responses:",
        "    unauthorized:",
        "      $ref: ./unauthorized.yaml",
        "",
      ].join("\n"),
    );

    const bundled = (await bundle(path.join(directory, "root.yaml"))) as {
      paths: {
        "/pets": { get: { responses: { "401": { $ref?: string; description?: string } } } };
      };
      components: { responses: Record<string, { description?: string; $ref?: string }> };
    };

    expect(bundled.components.responses.unauthorized).toEqual({ description: "no" });
    expect(bundled.components.responses.Unauthorized).toBeUndefined();

    expect(bundled.paths["/pets"].get.responses["401"].$ref).toBe(
      "#/components/responses/unauthorized",
    );
  });

  it("keeps readOnly and writeOnly on a schema $ref", async () => {
    const bundled = (await bundle({
      openapi: "3.1.0",
      info: { title: "Markers", version: "1" },
      paths: {},
      components: {
        schemas: {
          Nested: { type: "object" },
          Item: {
            type: "object",
            properties: {
              nested: { readOnly: true, $ref: "#/components/schemas/Nested" },
              secret: { writeOnly: true, type: "string" },
            },
          },
        },
      },
    })) as {
      components: { schemas: { Item: { properties: { nested: unknown; secret: unknown } } } };
    };

    expect(bundled.components.schemas.Item.properties.nested).toEqual({
      $ref: "#/components/schemas/Nested",
      readOnly: true,
    });

    expect(bundled.components.schemas.Item.properties.secret).toEqual({
      writeOnly: true,
      type: "string",
    });
  });

  it("reports a missing pointer and an invalid pointer", async () => {
    await expect(
      dereference({
        openapi: "3.1.0",
        info: { title: "Missing", version: "1" },
        paths: {},
        components: { schemas: { A: { $ref: "#/components/schemas/Missing" } } },
      }),
    ).rejects.toBeInstanceOf(MissingPointerError);

    await expect(
      bundle({
        openapi: "3.1.0",
        info: { title: "Bad", version: "1" },
        paths: {},
        components: { schemas: { A: { $ref: "#not-a-pointer" } } },
      }),
    ).rejects.toBeInstanceOf(InvalidPointerError);
  });

  it("groups continued resolver failures", async () => {
    const directory = await tempDir();

    const failure = await bundle(
      path.join(directory, "root.json"),
      {
        openapi: "3.1.0",
        info: { title: "Continue", version: "1" },
        paths: {},
        components: {
          schemas: {
            A: { $ref: "./missing-a.json" },
            B: { $ref: "./missing-b.json" },
          },
        },
      },
      { continueOnError: true },
    ).then(
      () => undefined,
      (cause: unknown) => cause,
    );

    expect(failure).toBeInstanceOf(JSONParserErrorGroup);
    if (!(failure instanceof JSONParserErrorGroup)) return;
    expect(failure.errors).toHaveLength(2);

    expect(
      failure.errors.every(
        (error) => error instanceof ResolverError && error.ioErrorCode === "ENOENT",
      ),
    ).toBe(true);
  });

  it("reports the file url from a custom resolver failure", async () => {
    await expect(
      parse("mem://root.json", {
        resolve: { file: false, http: false },
        resolvers: [
          {
            canRead: () => true,
            read: () => Promise.reject(Object.assign(new Error("nope"), { code: "ENOENT" })),
          },
        ],
      }),
    ).rejects.toMatchObject({
      source: "mem://root.json",
      ioErrorCode: "ENOENT",
      message: "nope",
    });
  });

  it("maps an HTTP timeout to TimeoutError", async () => {
    const server = createServer(() => undefined);

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected a TCP port");

    try {
      await expect(
        parse(`http://127.0.0.1:${address.port}/hang`, {
          resolve: { file: false, http: { timeout: 50, safeUrlResolver: false } },
        }),
      ).rejects.toBeInstanceOf(TimeoutError);
    } finally {
      server.close();
    }
  });
});
