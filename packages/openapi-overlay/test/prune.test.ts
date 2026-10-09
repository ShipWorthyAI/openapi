import { Effect } from "effect";
import { expect, test } from "vitest";
import { applyOverlay } from "../src/index.ts";

const ref = (category: string, name: string) => ({ $ref: `#/components/${category}/${name}` });

const selected = {
  overlay: "1.1.0",
  info: { title: "One operation", version: "1" },
  actions: [{ target: "$.paths.*[?(@.responses && !(@.operationId == 'getPet'))]", remove: true }],
};

function document() {
  const droppedSchemas = Object.fromEntries(
    Array.from({ length: 99 }, (_, index) => [`Dropped${index}`, { type: "string" }]),
  );

  const droppedPaths = Object.fromEntries(
    Array.from({ length: 99 }, (_, index) => [
      `/dropped/${index}`,
      {
        parameters: [ref("parameters", "DroppedParameter")],
        post: {
          operationId: `dropped${index}`,
          responses: {
            "200": {
              description: "OK",
              content: { "application/json": { schema: ref("schemas", `Dropped${index}`) } },
            },
          },
        },
      },
    ]),
  );

  return {
    openapi: "3.1.0",
    info: { title: "Pets", version: "1" },
    security: [{ GlobalAuth: [] }],
    paths: {
      "/pets": {
        summary: "Keep path metadata",
        parameters: [ref("parameters", "Tenant")],
        get: {
          operationId: "getPet",
          requestBody: ref("requestBodies", "PetInput"),
          responses: { "200": ref("responses", "PetResponse") },
          security: [{ PetAuth: [] }],
          callbacks: { changed: ref("callbacks", "Changed") },
        },
      },
      ...droppedPaths,
    },
    webhooks: { incoming: { $ref: "#/components/pathItems/Incoming" } },
    components: {
      schemas: {
        Pet: {
          type: "object",
          properties: { address: ref("schemas", "Address"), friend: ref("schemas", "Pet") },
        },
        Address: { type: "string" },
        Payload: { oneOf: [ref("schemas", "Pet")] },
        Input: { allOf: [ref("schemas", "Pet")] },
        HookPayload: { type: "string" },
        CallbackPayload: { type: "string" },
        ExampleOnly: { type: "string" },
        CycleA: ref("schemas", "CycleB"),
        CycleB: ref("schemas", "CycleA"),
        ...droppedSchemas,
      },
      parameters: {
        Tenant: { name: "tenant", in: "query", schema: { type: "string" } },
        DroppedParameter: { name: "dropped", in: "query", schema: ref("schemas", "Dropped0") },
      },
      requestBodies: {
        PetInput: {
          content: {
            "application/json": {
              schema: ref("schemas", "Input"),
              encoding: { pet: { headers: { "X-Encoding": ref("headers", "Encoding") } } },
            },
          },
        },
        Unused: { content: { "application/json": { schema: ref("schemas", "Dropped0") } } },
      },
      responses: {
        PetResponse: {
          description: "OK",
          content: {
            "application/json": {
              schema: ref("schemas", "Payload"),
              examples: { pet: ref("examples", "Pet") },
            },
          },
          headers: { "X-Pet": ref("headers", "Pet") },
          links: { self: ref("links", "Self") },
        },
        Unused: { description: "unused" },
      },
      headers: {
        Pet: { schema: { type: "string" } },
        Encoding: { schema: { type: "string" } },
        Unused: { schema: { type: "string" } },
      },
      examples: { Pet: { value: ref("schemas", "ExampleOnly") }, Unused: { value: 0 } },
      links: { Self: { operationId: "getPet" }, Unused: { operationId: "dropped0" } },
      securitySchemes: {
        GlobalAuth: { type: "http", scheme: "bearer" },
        PetAuth: { type: "apiKey", in: "header", name: "X-Pet" },
        Unused: { type: "http", scheme: "basic" },
      },
      pathItems: {
        Incoming: {
          post: {
            responses: {
              "200": {
                description: "OK",
                content: { "application/json": { schema: ref("schemas", "HookPayload") } },
              },
            },
          },
        },
        Unused: { get: { responses: { "200": { description: "OK" } } } },
      },
      callbacks: {
        Changed: {
          "{$request.body#/url}": {
            post: {
              responses: {
                "200": {
                  description: "OK",
                  content: { "application/json": { schema: ref("schemas", "CallbackPayload") } },
                },
              },
            },
          },
        },
        Unused: {},
      },
      "x-metadata": { keep: true },
    },
  };
}

test("operationId filtering keeps unused components and empty paths by default", async () => {
  const result = await Effect.runPromise(applyOverlay(document(), selected));

  expect(result.paths).toMatchObject({
    "/pets": { get: { operationId: "getPet" } },
    "/dropped/0": { parameters: [ref("parameters", "DroppedParameter")] },
  });

  expect(result.components).toEqual(document().components);
});

test("selects one of 100 operations and prunes transitive components across every category", async () => {
  const input = document();
  const before = structuredClone(input);

  const result = await Effect.runPromise(
    applyOverlay(input, selected, { removeUnusedComponents: true }),
  );

  expect(result.paths).toEqual({ "/pets": input.paths["/pets"] });
  expect(result.webhooks).toEqual(input.webhooks);

  expect(result.components).toEqual({
    schemas: {
      Pet: input.components.schemas.Pet,
      Address: input.components.schemas.Address,
      Payload: input.components.schemas.Payload,
      Input: input.components.schemas.Input,
      HookPayload: input.components.schemas.HookPayload,
      CallbackPayload: input.components.schemas.CallbackPayload,
    },
    parameters: { Tenant: input.components.parameters.Tenant },
    requestBodies: { PetInput: input.components.requestBodies.PetInput },
    responses: { PetResponse: input.components.responses.PetResponse },
    headers: { Pet: input.components.headers.Pet, Encoding: input.components.headers.Encoding },
    examples: { Pet: input.components.examples.Pet },
    links: { Self: input.components.links.Self },
    callbacks: { Changed: input.components.callbacks.Changed },
    pathItems: { Incoming: input.components.pathItems.Incoming },
    securitySchemes: {
      GlobalAuth: input.components.securitySchemes.GlobalAuth,
      PetAuth: input.components.securitySchemes.PetAuth,
    },
    "x-metadata": { keep: true },
  });

  expect(input).toEqual(before);
  expect(selected.actions).toHaveLength(1);
});

test("prunes only after all actions, including components introduced by later updates", async () => {
  const result = await Effect.runPromise(
    applyOverlay(
      {
        openapi: "3.1.0",
        info: { title: "Test", version: "1" },
        paths: {},
        components: { schemas: { Unused: false } },
      },
      {
        ...selected,
        actions: [
          { target: "$.components.schemas", update: { Added: false } },
          {
            target: "$.paths",
            update: {
              "/added": {
                get: {
                  responses: {
                    "200": {
                      description: "OK",
                      content: { "application/json": { schema: ref("schemas", "Added") } },
                    },
                  },
                },
              },
            },
          },
        ],
      },
      { removeUnusedComponents: true },
    ),
  );

  expect(result.components).toEqual({ schemas: { Added: false } });
});

test("preserves discriminator mapping targets by component name and escaped JSON Pointer", async () => {
  const input = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1" },
    paths: {
      "/pets": {
        get: {
          responses: {
            "200": {
              description: "OK",
              content: { "application/json": { schema: ref("schemas", "Base") } },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Base: {
          type: "object",
          discriminator: {
            propertyName: "kind",
            mapping: { cat: "Cat", dog: "#/components/schemas/Dog~1Kind/properties/name" },
          },
        },
        Cat: { type: "string" },
        "Dog/Kind": { type: "object", properties: { name: ref("schemas", "Name") } },
        Name: { type: "string" },
        Unused: { type: "string" },
      },
    },
  };

  const result = await Effect.runPromise(
    applyOverlay(
      input,
      { ...selected, actions: [{ target: "$", update: {} }] },
      { removeUnusedComponents: true },
    ),
  );

  expect(result.components).toEqual({
    schemas: {
      Base: input.components.schemas.Base,
      Cat: input.components.schemas.Cat,
      "Dog/Kind": input.components.schemas["Dog/Kind"],
      Name: input.components.schemas.Name,
    },
  });
});

test("drops all component groups when no operations survive", async () => {
  const input = document();

  const result = await Effect.runPromise(
    applyOverlay(
      input,
      {
        ...selected,
        actions: [
          { target: "$.paths.*", remove: true },
          { target: "$.webhooks", remove: true },
          { target: "$.security", remove: true },
        ],
      },
      { removeUnusedComponents: true },
    ),
  );

  expect(result.paths).toEqual({});
  expect(result.components).toEqual({ "x-metadata": { keep: true } });
});

test("reports references broken by an overlay without mutating the source", async () => {
  const input = document();
  const before = structuredClone(input);

  const result = await Effect.runPromise(
    applyOverlay(
      input,
      {
        ...selected,
        actions: [...selected.actions, { target: "$.components.schemas.Address", remove: true }],
      },
      { removeUnusedComponents: true },
    ).pipe(Effect.flip),
  );

  expect(result.message).toContain("Missing reference #/components/schemas/Address");
  expect(input).toEqual(before);
});

test("does not retain components because of refs inside examples, defaults, enums, or extensions", async () => {
  const input = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1" },
    paths: {
      "/pets": {
        get: {
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      example: ref("schemas", "Real"),
                      "x-name": ref("schemas", "Real"),
                    },
                    default: ref("schemas", "Unused"),
                    examples: [ref("schemas", "Unused")],
                    enum: [ref("schemas", "Unused")],
                    "x-data": ref("schemas", "Unused"),
                  },
                  example: ref("schemas", "Unused"),
                },
              },
            },
          },
        },
      },
    },
    components: { schemas: { Real: { type: "string" }, Unused: { type: "string" } } },
  };

  const result = await Effect.runPromise(
    applyOverlay(
      input,
      { ...selected, actions: [{ target: "$", update: {} }] },
      { removeUnusedComponents: true },
    ),
  );

  expect(result.components).toEqual({ schemas: { Real: { type: "string" } } });
});

test("retains implicit discriminator inheritance and its transitive descendants", async () => {
  const input = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1" },
    paths: {
      "/pets": {
        get: {
          responses: {
            "200": {
              description: "OK",
              content: { "application/json": { schema: ref("schemas", "Base") } },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Base: { type: "object", discriminator: { propertyName: "kind" } },
        Child: {
          allOf: [
            true,
            ref("schemas", "Base"),
            { type: "object", properties: { name: ref("schemas", "Name") } },
          ],
        },
        Grandchild: { allOf: [ref("schemas", "Child")] },
        Name: { type: "string" },
        Unused: { type: "string" },
      },
    },
  };

  const result = await Effect.runPromise(
    applyOverlay(
      input,
      { ...selected, actions: [{ target: "$", update: {} }] },
      { removeUnusedComponents: true },
    ),
  );

  expect(result.components).toEqual({
    schemas: {
      Base: input.components.schemas.Base,
      Child: input.components.schemas.Child,
      Grandchild: input.components.schemas.Grandchild,
      Name: input.components.schemas.Name,
    },
  });
});

test.each([{ $ref: "./external.yaml" }, { $ref: "#anchor" }, { $dynamicRef: "#anchor" }])(
  "fails explicitly for unsupported reachable schema references: %j",
  async (schema) => {
    const input = {
      openapi: "3.1.0",
      info: { title: "Test", version: "1" },
      paths: {
        "/pets": {
          get: {
            responses: {
              "200": { description: "OK", content: { "application/json": { schema } } },
            },
          },
        },
      },
    };

    const result = await Effect.runPromise(
      applyOverlay(
        input,
        { ...selected, actions: [{ target: "$", update: {} }] },
        { removeUnusedComponents: true },
      ).pipe(Effect.flip),
    );

    expect(result._tag).toBe("OverlayError");
    expect(result.message).toMatch(/bundled local JSON Pointer|does not support \$dynamicRef/);
  },
);

test("fails when a retained link names an operation removed by filtering", async () => {
  const input = document();
  input.components.links.Self.operationId = "dropped0";

  const result = await Effect.runPromise(
    applyOverlay(input, selected, { removeUnusedComponents: true }).pipe(Effect.flip),
  );

  expect(result.message).toContain("Missing linked operationId dropped0");
});

test("preserves component dependencies of retained root definitions", async () => {
  const input = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1" },
    paths: {},
    $defs: { Root: { allOf: [ref("schemas", "Used")] } },
    components: { schemas: { Used: { type: "string" }, Unused: { type: "string" } } },
  };

  const result = await Effect.runPromise(
    applyOverlay(
      input,
      { ...selected, actions: [{ target: "$", update: {} }] },
      { removeUnusedComponents: true },
    ),
  );

  expect(result.$defs).toEqual(input.$defs);
  expect(result.components).toEqual({ schemas: { Used: { type: "string" } } });
});

test("rejects a retained reference into a path that will be removed", async () => {
  const input = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1" },
    paths: {
      "/kept": {
        get: {
          parameters: [{ $ref: "#/paths/~1empty/parameters/0" }],
          responses: { "200": { description: "OK" } },
        },
      },
      "/empty": { parameters: [{ name: "tenant", in: "query", schema: { type: "string" } }] },
    },
  };

  const result = await Effect.runPromise(
    applyOverlay(
      input,
      { ...selected, actions: [{ target: "$", update: {} }] },
      { removeUnusedComponents: true },
    ).pipe(Effect.flip),
  );

  expect(result.message).toContain("Reference targets a removed path");
});

test("filters an operation without an ID while preserving metadata on a shared path", async () => {
  const input = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1" },
    paths: {
      "/pets": {
        summary: "Pets",
        parameters: [{ name: "tenant", in: "query", schema: { type: "string" } }],
        get: { operationId: "getPet", responses: { "200": { description: "OK" } } },
        post: { responses: { "200": { description: "OK" } } },
      },
    },
  };

  const result = await Effect.runPromise(
    applyOverlay(input, selected, { removeUnusedComponents: true }),
  );

  expect(result.paths).toEqual({
    "/pets": {
      summary: "Pets",
      parameters: input.paths["/pets"].parameters,
      get: input.paths["/pets"].get,
    },
  });
});
