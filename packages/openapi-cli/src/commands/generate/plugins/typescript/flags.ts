import { Flag } from "effect/cli";

function flag(name: string, description: string, defaultValue = false) {
  return Flag.Boolean(name).pipe(Flag.withDescription(description), Flag.withDefault(defaultValue));
}

export interface TypeFlags {
  readonly additionalProperties: boolean;
  readonly alphabetize: boolean;
  readonly arrayLength: boolean;
  readonly conditionalEnums: boolean;
  readonly dedupeEnums: boolean;
  readonly defaultNonNullable: boolean;
  readonly emptyObjectsUnknown: boolean;
  readonly enum: boolean;
  readonly enumValues: boolean;
  readonly excludeDeprecated: boolean;
  readonly exportType: boolean;
  readonly generatePathParams: boolean;
  readonly immutable: boolean;
  readonly makePathsEnum: boolean;
  readonly pathParamsAsTypes: boolean;
  readonly propertiesRequiredByDefault: boolean;
  readonly readWriteMarkers: boolean;
  readonly rootTypes: boolean;
  readonly rootTypesKeepCasing: boolean;
  readonly rootTypesNoSchemaPrefix: boolean;
}

export const defaultTypeFlags: TypeFlags = {
  additionalProperties: false,
  alphabetize: false,
  arrayLength: false,
  conditionalEnums: false,
  dedupeEnums: false,
  defaultNonNullable: true,
  emptyObjectsUnknown: false,
  enum: false,
  enumValues: false,
  excludeDeprecated: false,
  exportType: false,
  generatePathParams: false,
  immutable: false,
  makePathsEnum: false,
  pathParamsAsTypes: false,
  propertiesRequiredByDefault: false,
  readWriteMarkers: false,
  rootTypes: false,
  rootTypesKeepCasing: false,
  rootTypesNoSchemaPrefix: false,
};

export const typeFlags = {
  enum: flag("enum", "Export true TS enums instead of unions."),
  enumValues: flag("enum-values", "Export enum values as arrays."),
  conditionalEnums: flag(
    "conditional-enums",
    "Only generate true TS enums when enum metadata is available.",
  ),
  dedupeEnums: flag("dedupe-enums", "Dedupe enum types when --enum is set."),
  exportType: Flag.Boolean("export-type").pipe(
    Flag.withAlias("t"),
    Flag.withDescription("Export top-level type aliases instead of interfaces."),
    Flag.withDefault(false),
  ),
  immutable: flag("immutable", "Generate readonly types."),
  additionalProperties: flag(
    "additional-properties",
    "Treat schema objects as if additionalProperties: true is set.",
  ),
  emptyObjectsUnknown: flag(
    "empty-objects-unknown",
    "Generate unknown instead of Record<string, never> for empty objects.",
  ),
  defaultNonNullable: flag(
    "default-non-nullable",
    "Set to false to ignore default values when generating non-nullable types.",
    true,
  ),
  propertiesRequiredByDefault: flag(
    "properties-required-by-default",
    "Treat schema objects as if required lists every property.",
  ),
  arrayLength: flag("array-length", "Generate tuples using array minItems / maxItems."),
  pathParamsAsTypes: flag("path-params-as-types", "Convert paths to template literal types."),
  alphabetize: flag("alphabetize", "Sort object keys alphabetically."),
  excludeDeprecated: flag("exclude-deprecated", "Exclude deprecated types."),
  rootTypes: flag("root-types", "Export schema types at the root level."),
  rootTypesNoSchemaPrefix: flag(
    "root-types-no-schema-prefix",
    'Do not add a "Schema" prefix to root types. Requires --root-types.',
  ),
  rootTypesKeepCasing: flag(
    "root-types-keep-casing",
    "Keep the casing of root types. Requires --root-types.",
  ),
  makePathsEnum: flag("make-paths-enum", "Generate an ApiPaths enum for all paths."),
  readWriteMarkers: flag(
    "read-write-markers",
    "Generate $Read/$Write markers for readOnly/writeOnly properties.",
  ),
  generatePathParams: flag(
    "generate-path-params",
    "Generate path params from the path template even when the schema omits them.",
  ),
};

export function pluginOptions(flags: TypeFlags & { readonly silent?: boolean }) {
  return {
    additionalProperties: flags.additionalProperties,
    alphabetize: flags.alphabetize,
    arrayLength: flags.arrayLength,
    conditionalEnums: flags.conditionalEnums,
    dedupeEnums: flags.dedupeEnums,
    defaultNonNullable: flags.defaultNonNullable,
    emptyObjectsUnknown: flags.emptyObjectsUnknown,
    enum: flags.enum,
    enumValues: flags.enumValues,
    excludeDeprecated: flags.excludeDeprecated,
    exportType: flags.exportType,
    generatePathParams: flags.generatePathParams,
    immutable: flags.immutable,
    makePathsEnum: flags.makePathsEnum,
    pathParamsAsTypes: flags.pathParamsAsTypes,
    propertiesRequiredByDefault: flags.propertiesRequiredByDefault,
    readWriteMarkers: flags.readWriteMarkers,
    rootTypes: flags.rootTypes,
    rootTypesKeepCasing: flags.rootTypesKeepCasing,
    rootTypesNoSchemaPrefix: flags.rootTypesNoSchemaPrefix,
    silent: flags.silent ?? false,
  };
}
