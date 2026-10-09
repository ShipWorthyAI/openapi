import { Schema } from "effect";

function overlayObject<const Fields extends Schema.Struct.Fields>(fields: Fields) {
  return Schema.StructWithRest(Schema.Struct(fields), [
    Schema.Record(Schema.String, Schema.Json),
  ]).check(
    Schema.makeFilter((value) => {
      const unexpected = Object.keys(value).find(
        (key) => !Object.hasOwn(fields, key) && !key.startsWith("x-"),
      );

      return unexpected === undefined
        ? undefined
        : `Unexpected field ${JSON.stringify(unexpected)}`;
    }),
  );
}

export const OverlayInfo = overlayObject({
  title: Schema.String,
  version: Schema.String,
  description: Schema.optionalKey(Schema.String),
});

export type OverlayInfo = typeof OverlayInfo.Type;

export const OverlayAction = overlayObject({
  target: Schema.String,
  description: Schema.optionalKey(Schema.String),
  update: Schema.optionalKey(Schema.Json),
  copy: Schema.optionalKey(Schema.String),
  remove: Schema.optionalKey(Schema.Boolean),
});

export type OverlayAction = typeof OverlayAction.Type;

export const Overlay = overlayObject({
  overlay: Schema.String.check(Schema.isPattern(/^1\.[01]\.\d+$/)),
  info: OverlayInfo,
  extends: Schema.optionalKey(Schema.String),
  actions: Schema.Array(OverlayAction).check(Schema.isMinLength(1)),
});

export type Overlay = typeof Overlay.Type;
