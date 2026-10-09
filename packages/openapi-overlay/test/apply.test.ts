import { Effect, Schema } from "effect";
import { describe, expect, test } from "vitest";
import { applyOverlay, Overlay, OverlayError, type OverlayAction } from "../src/index.ts";

function overlay(...actions: OverlayAction[]) {
  return { overlay: "1.1.0", info: { title: "Test", version: "1" }, actions };
}

function apply(document: unknown, ...actions: OverlayAction[]) {
  return Effect.runPromise(applyOverlay(document, overlay(...actions)));
}

function failure(document: unknown, input: unknown) {
  return Effect.runPromise(applyOverlay(document, input).pipe(Effect.flip));
}

test.each([undefined, {}, { removeUnusedComponents: false }])(
  "keeps pruning disabled for options %j",
  async (options) => {
    expect(
      await Effect.runPromise(
        applyOverlay({}, overlay({ target: "$", update: { kept: true } }), options),
      ),
    ).toEqual({ kept: true });
  },
);

test.each([
  null,
  [],
  { removeUnusedComponents: "true" },
  { removeUnusedComponents: 1 },
  { unknown: true },
])("reports invalid options %j as OverlayError", async (options) => {
  const document = { kept: true };

  const error = await Effect.runPromise(
    applyOverlay(
      document,
      overlay({ target: "$", update: { added: true } }),
      options as never,
    ).pipe(Effect.flip),
  );

  expect(error).toBeInstanceOf(OverlayError);
  expect(error.message).toContain("Invalid options:");
  expect(document).toEqual({ kept: true });
});

test("merges objects recursively, concatenates arrays, and replaces primitives", async () => {
  const document = {
    info: { title: "Pets", version: "1" },
    tags: ["original"],
    nested: { retained: true, value: 1, list: [{ name: "original" }] },
  };

  expect(
    await apply(document, {
      target: "$",
      update: {
        info: { title: "Public Pets", description: "A public API" },
        tags: ["new"],
        nested: { value: null, list: [{ name: "new" }], added: false },
      },
    }),
  ).toEqual({
    info: { title: "Public Pets", version: "1", description: "A public API" },
    tags: ["original", "new"],
    nested: {
      retained: true,
      value: null,
      list: [{ name: "original" }, { name: "new" }],
      added: false,
    },
  });

  expect(document.info.title).toBe("Pets");
});

test.each([null, false, 0, "replacement"])("replaces a primitive with %j", async (update) => {
  expect(await apply({ value: "old" }, { target: "$.value", update })).toEqual({ value: update });
});

test.each([null, false, 0, "tag", { name: "tag" }, ["a", "b"], [["nested"]]])(
  "appends or concatenates %j to a selected array",
  async (update) => {
    expect(await apply({ tags: ["old"] }, { target: "$.tags", update })).toEqual({
      tags: ["old", ...(Array.isArray(update) ? update : [update])],
    });
  },
);

test("applies actions sequentially, including create, copy, remove, and subsequent updates", async () => {
  expect(
    await apply(
      { paths: { "/items": { get: { description: "Original" } } } },
      { target: "$.paths", update: { "/new-items": {} } },
      { target: "$.paths['/new-items']", copy: "$.paths['/items']" },
      { target: "$.paths['/items']", remove: true },
      { target: "$.paths['/new-items'].get.description", update: "Updated" },
    ),
  ).toEqual({ paths: { "/new-items": { get: { description: "Updated" } } } });
});

test("copy merges objects, appends arrays and primitives, and captures its source before mutation", async () => {
  expect(
    await apply(
      { source: { nested: { tags: ["copied"] } }, destinations: [{}, {}] },
      { target: "$.destinations[*]", copy: "$.source" },
      { target: "$.destinations[0].nested.tags", update: "first-only" },
    ),
  ).toEqual({
    source: { nested: { tags: ["copied"] } },
    destinations: [
      { nested: { tags: ["copied", "first-only"] } },
      { nested: { tags: ["copied"] } },
    ],
  });

  expect(
    await apply({ source: [1], target: [0] }, { target: "$.target", copy: "$.source" }),
  ).toEqual({ source: [1], target: [0, 1] });

  expect(
    await apply({ source: null, target: false }, { target: "$.target", copy: "$.source" }),
  ).toEqual({ source: null, target: null });

  expect(await apply({ values: [1] }, { target: "$.values", copy: "$.values" })).toEqual({
    values: [1, 1],
  });
});

test("update values are independent of the overlay and each selected target", async () => {
  const input = overlay(
    { target: "$.items[*]", update: { tags: ["shared"] } },
    { target: "$.items[0].tags", update: "first-only" },
  );

  const before = structuredClone(input);

  expect(await Effect.runPromise(applyOverlay({ items: [{}, {}] }, input))).toEqual({
    items: [{ tags: ["shared", "first-only"] }, { tags: ["shared"] }],
  });

  expect(input).toEqual(before);
});

test("removes multiple original array indexes, duplicates, objects, and primitive nodes", async () => {
  expect(
    await apply({ tags: ["a", "b", "c", "d"] }, { target: "$.tags[0,2,2]", remove: true }),
  ).toEqual({ tags: ["b", "d"] });

  expect(
    await apply(
      { items: [{ name: "dummy" }, { name: "keep" }, { name: "dummy" }] },
      { target: "$.items[?@.name == 'dummy']", remove: true },
    ),
  ).toEqual({ items: [{ name: "keep" }] });

  expect(
    await apply(
      { tags: ["dummy", "keep", "dummy"], secret: 1 },
      { target: "$.tags[?@ == 'dummy']", remove: true },
      { target: "$.secret", remove: true },
    ),
  ).toEqual({ tags: ["keep"] });
});

test("removes overlapping descendants and their containing arrays without shifted indexes", async () => {
  expect(
    await apply(
      {
        items: [
          [1, 2],
          [3, 4],
        ],
      },
      { target: "$..*", remove: true },
    ),
  ).toEqual({});
});

test("remove true takes precedence over update and copy", async () => {
  expect(
    await apply(
      { secret: {} },
      {
        target: "$.secret",
        remove: true,
        update: "incompatible",
        copy: "invalid JSONPath",
      },
    ),
  ).toEqual({});
});

test("unmatched actions succeed without creating nodes or requiring a copy source", async () => {
  expect(
    await apply(
      { paths: {} },
      { target: "$.missing", update: {} },
      { target: "$.missing", copy: "$.missingSource" },
      { target: "$.missing", remove: true },
    ),
  ).toEqual({ paths: {} });
});

test("supports RFC 9535 wildcards, descendant selectors, slices, filters, and functions", async () => {
  const document = {
    paths: {
      "/items": { get: { "x-oai-traits": ["paged"], parameters: [] } },
      "/other": { get: { parameters: [] } },
    },
    tags: ["a", "b", "c", "d"],
  };

  expect(
    await apply(
      document,
      {
        target: "$.paths[?(@.get['x-oai-traits'][?(@ == 'paged')])].get",
        update: { "x-paged": true },
      },
      { target: "$..parameters", update: { name: "limit", in: "query" } },
      { target: "$.tags[1:4:2]", update: "selected" },
      { target: "$.paths[?length(@.get.parameters) == 1].get", update: { "x-one-param": true } },
    ),
  ).toEqual({
    paths: {
      "/items": {
        get: {
          "x-oai-traits": ["paged"],
          parameters: [{ name: "limit", in: "query" }],
          "x-paged": true,
          "x-one-param": true,
        },
      },
      "/other": { get: { parameters: [{ name: "limit", in: "query" }], "x-one-param": true } },
    },
    tags: ["a", "selected", "c", "selected"],
  });
});

test.each(["yaml", "json", "formatted json"])(
  "accepts %s documents and overlays",
  async (format) => {
    const indent = format === "formatted json" ? 2 : undefined;

    const document =
      format === "yaml"
        ? "info: { title: Pets }"
        : JSON.stringify({ info: { title: "Pets" } }, null, indent);

    const input =
      format === "yaml"
        ? "overlay: 1.1.0\ninfo: { title: Test, version: '1' }\nactions:\n  - target: $.info.title\n    update: Public\n"
        : JSON.stringify(overlay({ target: "$.info.title", update: "Public" }), null, indent);

    expect(await Effect.runPromise(applyOverlay(document, input))).toEqual({
      info: { title: "Public" },
    });
  },
);

test("parses nested YAML sequences and keeps aliases independent", async () => {
  const document = "items:\n  - &item { tags: [] }\n  - *item\n";

  const input =
    "overlay: 1.1.0\ninfo: { title: Test, version: '1' }\nactions:\n  - target: $.items[0].tags\n    update:\n      -\n        - nested\n";

  expect(await Effect.runPromise(applyOverlay(document, input))).toEqual({
    items: [{ tags: [["nested"]] }, { tags: [] }],
  });
});

test("preserves specification extensions and descriptive metadata in the schema", () => {
  const input = {
    ...overlay({ target: "$", update: {}, "x-action": null }),
    extends: "./openapi.yaml",
    "x-overlay": [1],
    info: { title: "Test", version: "1", description: "**Description**", "x-info": true },
  };

  expect(Schema.decodeSync(Overlay)(input)).toEqual(input);
});

test("public schemas reject undeclared properties at every level", () => {
  const base = overlay({ target: "$", update: {} });

  for (const input of [
    { ...base, extra: true },
    { ...base, info: { ...base.info, extra: true } },
    { ...base, actions: [{ target: "$", update: {}, extra: true }] },
  ]) {
    expect(() => Schema.decodeSync(Overlay)(input)).toThrow();
  }
});

test.each(["1.0.0", "1.1.0", "1.1.42"])("ignores the patch version for %s", async (version) => {
  expect(
    await Effect.runPromise(
      applyOverlay({}, { ...overlay({ target: "$", update: {} }), overlay: version }),
    ),
  ).toEqual({});
});

describe("typed failures", () => {
  test.each([
    [{ a: [] }, { target: "$", update: { a: {} } }],
    [{ a: {} }, { target: "$", update: { a: [] } }],
    [{ a: [] }, { target: "$", update: { a: null } }],
    [{ a: null }, { target: "$", update: { a: {} } }],
    [{ a: 1 }, { target: "$.a", update: [] }],
    [{ a: {} }, { target: "$.a", update: null }],
  ] as const)("rejects incompatible update %j / %j", async (document, action) => {
    const error = await failure(document, overlay(action));

    expect(error).toBeInstanceOf(OverlayError);
    expect(error.action).toBe(1);
    expect(error.target).toBe(action.target);
  });

  test("requires homogeneous target categories", async () => {
    expect(
      (await failure({ items: [{}, []] }, overlay({ target: "$.items[*]", update: {} }))).message,
    ).toContain("same category");
  });

  test.each(["$.missing", "$.items[*]"])("requires a single copy source: %s", async (copy) => {
    expect(
      (await failure({ target: {}, items: [{}, {}] }, overlay({ target: "$.target", copy })))
        .message,
    ).toContain("exactly one");
  });

  test("rejects ambiguous update/copy and root removal", async () => {
    expect((await failure({}, overlay({ target: "$", update: {}, copy: "$" }))).message).toContain(
      "both update and copy",
    );

    expect((await failure({}, overlay({ target: "$", remove: true }))).message).toContain("root");
  });

  test.each(["$.items[", "$.items[?(@.a = 1)]", "$.items[?(@.a.toString())]"])(
    "rejects invalid or nonstandard JSONPath: %s",
    async (target) => {
      expect((await failure({ items: [] }, overlay({ target, update: {} }))).action).toBe(1);
    },
  );

  test.each([
    {},
    { ...overlay({ target: "$", update: {} }), overlay: "2.0.0" },
    { ...overlay({ target: "$", update: {} }), actions: [] },
    { ...overlay({ target: "$", update: {} }), info: { title: "Missing version" } },
    { ...overlay({ target: "$", update: {} }), extra: true },
    overlay({ target: "$", remove: "true" } as unknown as OverlayAction),
    overlay({ target: "$", update: undefined } as unknown as OverlayAction),
    "overlay: [",
    "overlay: 1.1.0\noverlay: 1.1.0",
  ])("rejects malformed overlays: %j", async (input) => {
    expect((await failure({}, input)).message).toContain("Invalid overlay");
  });

  test.each([
    [],
    null,
    { number: Number.POSITIVE_INFINITY },
    "value: .nan",
    "items:\n  - - nested",
    "items: [\n  value\n]",
  ])("rejects non-object or non-JSON document %j", async (document) => {
    expect((await failure(document, overlay({ target: "$", update: {} }))).message).toContain(
      "Invalid document",
    );
  });

  test("does not mutate the caller's document when a later merge fails", async () => {
    const document = { info: { title: "Original", tags: [] } };

    await failure(
      document,
      overlay({ target: "$", update: { info: { title: "Updated", tags: {} } } }),
    );

    expect(document).toEqual({ info: { title: "Original", tags: [] } });
  });
});

test("handles JSON keys such as __proto__ as data", async () => {
  const result = await apply(
    {},
    { target: "$", update: JSON.parse('{"__proto__":{"polluted":true}}') },
  );

  expect(Object.hasOwn(result, "__proto__")).toBe(true);
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  expect(Object.hasOwn({}, "polluted")).toBe(false);
});
