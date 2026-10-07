
export interface OpenAPITSOptions {
  /** Treat all objects as if they have `additionalProperties: true` by default (default: false) */
  additionalProperties?: boolean;
  /** Alphabetize all keys? (default: false) */
  alphabetize?: boolean;
  /** (optional) Generate tuples using array minItems / maxItems */
  arrayLength?: boolean;
  /** Allow schema objects with no specified properties to have additional properties if not expressly forbidden? (default: false) */
  emptyObjectsUnknown?: boolean;
  /** Provide current working directory (cwd) which helps resolve relative remote schemas */
  cwd?: PathLike;
  /** Should schema objects with a default value not be considered optional? */
  defaultNonNullable?: boolean;
  /** Exclude deprecated fields from types? (default: false) */
  excludeDeprecated?: boolean;
  /** Manually transform certain Schema Objects with a custom TypeScript type */
  transform?: (
    schemaObject: SchemaObject,
    options: TransformNodeOptions,
  ) => ts.TypeNode | TransformObject | undefined;
  /** Modify TypeScript types built from Schema Objects */
  postTransform?: (type: ts.TypeNode, options: TransformNodeOptions) => ts.TypeNode | undefined;
  /** Modify property signatures for Schema Object properties */
  transformProperty?: (
    property: ts.PropertySignature,
    schemaObject: SchemaObject,
    options: TransformNodeOptions,
  ) => ts.PropertySignature | undefined;
  /** Add readonly properties and readonly arrays? (default: false) */
  immutable?: boolean;
  /** (optional) Should logging be suppressed? (necessary for STDOUT) */
  silent?: boolean;
  /** (optional) OpenAPI version. Must be present if parsing raw schema */
  version?: number;
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
  /** (optional) Substitute path parameter names with their respective types */
  pathParamsAsTypes?: boolean;
  /** Treat all objects as if they have \`required\` set to all properties by default (default: false) */
  propertiesRequiredByDefault?: boolean;
  /** (optional) Generate schema types at root level */
  rootTypes?: boolean;
  /** (optional) Do not add Schema prefix to types at root level */
  rootTypesNoSchemaPrefix?: boolean;
  /** (optional) Keep casing of root types */
  rootTypesKeepCasing?: boolean;
  /** Inject arbitrary TypeScript types into the start of the file */
  inject?: string;
  /** Generate ApiPaths enum */
  makePathsEnum?: boolean;
  /** Generate path params based on path even if they are not defined in the open api schema */
  generatePathParams?: boolean;
  /** Generate $Read/$Write markers for readOnly/writeOnly properties (default: false) */
  readWriteMarkers?: boolean;
}

/** Context passed to all submodules */
export interface GlobalContext {
  // user options
  additionalProperties: boolean;
  alphabetize: boolean;
  arrayLength: boolean;
  defaultNonNullable: boolean;
  discriminators: {
    objects: Record<string, DiscriminatorObject>;
    refsHandled: string[];
  };
  emptyObjectsUnknown: boolean;
  enum: boolean;
  enumValues: boolean;
  conditionalEnums: boolean;
  dedupeEnums: boolean;
  excludeDeprecated: boolean;
  exportType: boolean;
  immutable: boolean;
  injectFooter: ts.Node[];
  pathParamsAsTypes: boolean;
  postTransform: OpenAPITSOptions["postTransform"];
  propertiesRequiredByDefault: boolean;
  rootTypes: boolean;
  rootTypesNoSchemaPrefix: boolean;
  rootTypesKeepCasing: boolean;
  silent: boolean;
  transform: OpenAPITSOptions["transform"];
  transformProperty: OpenAPITSOptions["transformProperty"];
  /** retrieve a node by $ref */
  resolve<T>($ref: string): T | undefined;
  inject?: string;
  makePathsEnum: boolean;
  generatePathParams: boolean;
  readWriteMarkers: boolean;
}

export type $defs = Record<string, SchemaObject>;

/** generic options for most internal transform* functions */
export interface TransformNodeOptions {
  path?: string;
  schema?: SchemaObject | ReferenceObject;
  ctx: GlobalContext;
}
