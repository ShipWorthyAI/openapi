import { Effect, Schema } from "effect";
import { expect, test } from "vitest";
import { applyOverlay, Overlay, type OverlayAction } from "../src/index.ts";
import * as V10 from "@shipworthy/overlay/schemas/1.0";
import * as V11 from "@shipworthy/overlay/schemas/1.1";

function overlay(version: string, ...actions: OverlayAction[]) {
  return { overlay: version, info: { title: "Test", version: "1" }, actions };
}

function apply(version: string, document: unknown, ...actions: OverlayAction[]) {
  return Effect.runPromise(applyOverlay(document, overlay(version, ...actions)));
}

function failure(version: string, document: unknown, ...actions: OverlayAction[]) {
  return Effect.runPromise(applyOverlay(document, overlay(version, ...actions)).pipe(Effect.flip));
}

test.each(["1.0.0", "1.0.42", "1.1.0", "1.1.42"])(
  "uses the declared feature version %s",
  async (version) => {
    expect(
      await apply(
        version,
        { info: { title: "Original" }, entries: [] },
        { target: "$.info", update: { title: "Updated" } },
        { target: "$.entries", update: { name: "added" } },
      ),
    ).toEqual({ info: { title: "Updated" }, entries: [{ name: "added" }] });
  },
);

test.each(["1.0.0", "1.0.42"])("rejects 1.1 fields in %s documents", (version) => {
  const base = overlay(version, { target: "$", update: {} });

  expect(() =>
    Schema.decodeSync(Overlay)({ ...base, info: { ...base.info, description: "1.1 only" } }),
  ).toThrow();

  expect(() => Schema.decodeSync(Overlay)(overlay(version, { target: "$", copy: "$" }))).toThrow();
});

test("version-specific schema entry points retain inferred types and reject other versions", () => {
  const one: V10.Overlay = overlay("1.0.0", { target: "$", update: {} });

  const newer: V11.Overlay = {
    ...overlay("1.1.0", { target: "$", copy: "$" }),
    info: { title: "Test", version: "1", description: "1.1" },
  };

  expect(Schema.decodeSync(V10.Overlay)(one)).toEqual(one);
  expect(Schema.decodeSync(V11.Overlay)(newer)).toEqual(newer);
  expect(() => Schema.decodeSync(V10.Overlay)(newer)).toThrow();
  expect(() => Schema.decodeSync(V11.Overlay)(one)).toThrow();
});

test.each([null, false, 0, "old"])("1.0 rejects primitive targets: %j", async (value) => {
  const actions: ReadonlyArray<OverlayAction> = [
    { target: "$.value", update: "new" },
    { target: "$.value", remove: true },
  ];

  for (const action of actions) {
    const error = await failure("1.0.0", { value }, action);

    expect(error.message).toContain("1.0 targets must select objects or arrays");
    expect(error.action).toBe(1);
  }

  expect(await apply("1.1.0", { value }, { target: "$.value", update: "new" })).toEqual({
    value: "new",
  });

  expect(await apply("1.1.0", { value }, { target: "$.value", remove: true })).toEqual({});
});

test("1.0 appends an array update as a single entry; 1.1 concatenates", async () => {
  expect(await apply("1.0.0", { entries: [0] }, { target: "$.entries", update: [1, 2] })).toEqual({
    entries: [0, [1, 2]],
  });

  expect(await apply("1.1.0", { entries: [0] }, { target: "$.entries", update: [1, 2] })).toEqual({
    entries: [0, 1, 2],
  });
});

test("1.0 allows mixed object and array targets while 1.1 requires one category", async () => {
  expect(
    await apply(
      "1.0.0",
      { entries: [{}, []] },
      { target: "$.entries[*]", update: { name: "added" } },
    ),
  ).toEqual({ entries: [{ name: "added" }, [{ name: "added" }]] });

  expect(
    (await failure("1.1.0", { entries: [{}, []] }, { target: "$.entries[*]", update: {} })).message,
  ).toContain("same category");
});

test.each(["1.0.0", "1.1.0"])(
  "version %s rejects structurally duplicate actions",
  async (version) => {
    const input = JSON.stringify(
      overlay(
        version,
        { target: "$.entries", update: { a: 1, b: [true, null] } },
        { update: { b: [true, null], a: 1 }, target: "$.entries" },
      ),
    );

    const error = await Effect.runPromise(applyOverlay({ entries: [] }, input).pipe(Effect.flip));

    expect(error.message).toContain("Invalid overlay");
  },
);

test.each(["1.0.0", "1.1.0"])(
  "version %s preserves extensions and optional field omission",
  (version) => {
    const input = {
      ...overlay(version, { target: "$", update: {}, "x-action": null }),
      info: { title: "Test", version: "1", "x-info": [true] },
      "x-overlay": { owner: "Test" },
    };

    const result = Schema.decodeSync(Overlay)(input);

    expect(result).toEqual(input);
    expect(Object.hasOwn(result.actions[0]!, "remove")).toBe(false);
  },
);

test.each(["1.0.0", "1.1.0"])(
  "version %s rejects unknown fields and malformed targets",
  (version) => {
    for (const input of [
      { ...overlay(version, { target: "$", update: {} }), extra: true },
      {
        ...overlay(version, { target: "$", update: {} }),
        info: { title: "Test", version: "1", extra: true },
      },
      overlay(version, { target: "$", update: {}, extra: true }),
      overlay(version, { target: "not JSONPath", update: {} }),
    ]) {
      expect(() => Schema.decodeSync(Overlay)(input)).toThrow();
    }
  },
);

test.each(["1.2.0", "2.0.0", "1.10.0", "1.1", "1.1.0-extra"])(
  "rejects unsupported or malformed version %s",
  (version) => {
    expect(() =>
      Schema.decodeSync(Overlay)(overlay(version, { target: "$", update: {} })),
    ).toThrow();
  },
);
