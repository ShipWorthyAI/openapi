import type { ParsedDiscriminator, ParsedSchema } from "@shipworthy/openapi-transformer";
import type { JsonSchema } from "effect";
import type ts from "#compiler";

/** A `transform` result that also decides whether the property is optional. */
export interface TransformObject {
  schema: ts.TypeNode;
  questionToken: boolean;
}

export interface OpenAPITSOptions {
  /** Generate tuples using array minItems / maxItems (default: true) */
  arrayLength?: boolean;
  /** Manually transform certain Schema Objects with a custom TypeScript type */
  transform?: (
    schemaObject: JsonSchema.JsonSchema,
    options: TransformNodeOptions,
  ) => ts.TypeNode | TransformObject | undefined;
  /** Modify TypeScript types built from Schema Objects */
  postTransform?: (type: ts.TypeNode, options: TransformNodeOptions) => ts.TypeNode | undefined;
  /** Modify property signatures for Schema Object properties */
  transformProperty?: (
    property: ts.PropertySignature,
    schemaObject: JsonSchema.JsonSchema,
    options: TransformNodeOptions,
  ) => ts.PropertySignature | undefined;
  /** (optional) Should logging be suppressed? (necessary for STDOUT) */
  silent?: boolean;
  /** (optional) Export type instead of interface */
  exportType?: boolean;
  /** Export true TypeScript enums instead of unions */
  enum?: boolean;
  /** Export union values as arrays */
  enumValues?: boolean;
  /** Only generate TS Enums when `x-enum-*` metadata is available */
  conditionalEnums?: boolean;
  /** Dedupe enum values */
  dedupeEnums?: boolean;
  /** Export component and operation type aliases at root level (default: false) */
  rootTypes?: boolean;
  /** Inject arbitrary TypeScript types into the start of the file */
  inject?: string;
  /** Generate $Read/$Write markers for readOnly/writeOnly properties (default: false) */
  readWriteMarkers?: boolean;
}

/** Context passed to all submodules */
export interface GlobalContext {
  // user options
  arrayLength: boolean;
  discriminators: {
    objects: Record<string, ParsedDiscriminator>;
    refsHandled: string[];
  };
  enum: boolean;
  enumValues: boolean;
  conditionalEnums: boolean;
  dedupeEnums: boolean;
  exportType: boolean;
  injectFooter: ts.Node[];
  postTransform: OpenAPITSOptions["postTransform"];
  rootTypes: boolean;
  silent: boolean;
  transform: OpenAPITSOptions["transform"];
  transformProperty: OpenAPITSOptions["transformProperty"];
  /** Retrieve a node of the parsed model by `$ref`. */
  resolve($ref: string): unknown;
  inject?: string;
  readWriteMarkers: boolean;
}

/** What the `transform`, `postTransform`, and `transformProperty` hooks receive. */
export interface TransformNodeOptions {
  /** JSON Pointer of the schema in the bundled document. */
  path?: string;
  schema?: ParsedSchema;
  ctx: GlobalContext;
}
