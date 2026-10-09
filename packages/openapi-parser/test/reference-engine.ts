import { NodeFileSystem, NodeHttpClient } from "@effect/platform-node";
import { Array, Effect, Layer, Schema, SchemaGetter } from "effect";
import { runEffect } from "../src/run.ts";
import { Options } from "../src/plugins.ts";

const layer = Layer.mergeAll(NodeFileSystem.layer, NodeHttpClient.layerUndici);

function run(mode: NonNullable<Parameters<typeof runEffect>[0]["mode"]>, args: unknown[]) {
  return Effect.runPromise(
    Schema.decodeEffect(argumentsSchema)(args).pipe(
      Effect.flatMap((request) => runEffect({ ...request, mode })),
      Effect.map((result) => result.schema),
      Effect.provide(layer),
    ),
  );
}

export const parse = (...args: unknown[]) => run("parse", args);
export const bundle = (...args: unknown[]) => run("bundle", args);
export const dereference = (...args: unknown[]) => run("dereference", args);

const optionsMarker = Schema.Record(Schema.String, Schema.Unknown).check(
  Schema.makeFilter((value) =>
    Array.some(Object.keys(Options.fields), (key) => Object.hasOwn(value, key))
      ? undefined
      : "Expected parser options",
  ),
);

const rawRequest = Schema.Struct({
  path: Schema.String,
  schema: Schema.Unknown,
  options: Schema.Unknown,
});

const request = Schema.Struct({ path: Schema.String, schema: Schema.Unknown, options: Options });

function argumentsToRequest<S extends Schema.Top>(
  source: S,
  decode: (value: S["Type"]) => typeof rawRequest.Type,
) {
  return source.pipe(
    Schema.decodeTo(rawRequest, {
      decode: SchemaGetter.transform(decode),
      encode: SchemaGetter.forbidden(() => "Legacy arguments cannot be encoded"),
    }),
  );
}

const argumentsSchema = Schema.Union([
  argumentsToRequest(Schema.Tuple([Schema.String, optionsMarker]), ([path, options]) => ({
    path,
    schema: undefined,
    options,
  })),
  argumentsToRequest(
    Schema.TupleWithRest(
      Schema.Tuple([
        Schema.String,
        Schema.Unknown,
        Schema.Unknown.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
      ]),
      [Schema.Unknown],
    ),
    ([path, schema, options]) => ({ path, schema, options }),
  ),
  argumentsToRequest(
    Schema.TupleWithRest(Schema.Tuple([Schema.String]), [Schema.Unknown]),
    ([path, schema]) => ({ path, schema, options: {} }),
  ),
  argumentsToRequest(
    Schema.TupleWithRest(Schema.Tuple([Schema.Unknown, optionsMarker]), [Schema.Unknown]),
    ([schema, options]) => ({ path: "", schema, options }),
  ),
  argumentsToRequest(Schema.Array(Schema.Unknown), ([schema]) => ({
    path: "",
    schema,
    options: {},
  })),
]).pipe(Schema.decodeTo(request));
