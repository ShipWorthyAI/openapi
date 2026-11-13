// Generated from schemas/v1.0/schema.yaml (sha256: 209a9755d58f96b5d80bf5a3ed4f6f2b9e77550fa27849cd67bd50bc3eabfa83).
// Run bun run generate:schemas to regenerate. Do not edit by hand.

import { Schema } from "effect";

export const OverlayInfo = Schema.StructWithRest(
  Schema.Struct({ title: Schema.String, version: Schema.String }),
  [Schema.Record(Schema.String, Schema.Json.annotate({ expected: "JSON value" }))],
).check(
  Schema.isPropertyNames(
    Schema.Union([
      Schema.Literals(["title", "version"]),
      Schema.String.check(
        Schema.isPattern(new globalThis.RegExp("^x-", "u")).annotate({
          expected: "a string matching the RegExp ^x-",
        }),
      ),
    ]),
  ).annotate({
    expected: "an object with property names matching the schema",
    identifier: "OverlayInfo",
  }),
);

export type OverlayInfo = typeof OverlayInfo.Type;

export const OverlayAction = Schema.StructWithRest(
  Schema.Struct({
    target: Schema.String.check(
      Schema.isPattern(new globalThis.RegExp("^\\$", "u")).annotate({
        expected: "a string matching the RegExp ^\\$",
      }),
    ),
    description: Schema.optionalKey(Schema.String),
    update: Schema.optionalKey(
      Schema.Union([
        Schema.String,
        Schema.Boolean,
        Schema.Record(Schema.String, Schema.Json.annotate({ expected: "JSON value" })),
        Schema.Array(Schema.Json.annotate({ expected: "JSON value" })),
        Schema.Finite,
        Schema.Null,
      ]),
    ),
    remove: Schema.optionalKey(Schema.Boolean.annotate({ default: false })),
  }),
  [Schema.Record(Schema.String, Schema.Json.annotate({ expected: "JSON value" }))],
).check(
  Schema.isPropertyNames(
    Schema.Union([
      Schema.Literals(["target", "description", "update", "remove"]),
      Schema.String.check(
        Schema.isPattern(new globalThis.RegExp("^x-", "u")).annotate({
          expected: "a string matching the RegExp ^x-",
        }),
      ),
    ]),
  ).annotate({
    expected: "an object with property names matching the schema",
    identifier: "OverlayAction",
  }),
);

export type OverlayAction = typeof OverlayAction.Type;

export const Overlay = Schema.StructWithRest(
  Schema.Struct({
    overlay: Schema.String.check(
      Schema.isPattern(new globalThis.RegExp("^1\\.0\\.\\d+$", "u")).annotate({
        expected: "a string matching the RegExp ^1\\.0\\.\\d+$",
      }),
    ),
    info: OverlayInfo,
    extends: Schema.optionalKey(Schema.String.annotate({ format: "uri-reference" })),
    actions: Schema.Array(OverlayAction)
      .check(Schema.isMinLength(1).annotate({ expected: "a value with a length of at least 1" }))
      .check(Schema.isUnique().annotate({ expected: "an array with unique items" })),
  }),
  [Schema.Record(Schema.String, Schema.Json.annotate({ expected: "JSON value" }))],
)
  .annotate({ description: "The description of Overlay v1.0.x documents" })
  .check(
    Schema.isPropertyNames(
      Schema.Union([
        Schema.Literals(["overlay", "info", "extends", "actions"]),
        Schema.String.check(
          Schema.isPattern(new globalThis.RegExp("^x-", "u")).annotate({
            expected: "a string matching the RegExp ^x-",
          }),
        ),
      ]),
    ).annotate({ expected: "an object with property names matching the schema" }),
  );

export type Overlay = typeof Overlay.Type;
