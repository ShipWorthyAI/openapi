import { Flag } from "effect/cli";

function flag(name: string, description: string) {
  return Flag.Boolean(name).pipe(Flag.withDescription(description), Flag.withDefault(false));
}

export interface TypeFlags {
  readonly arrayLength: boolean;
  readonly conditionalEnums: boolean;
  readonly dedupeEnums: boolean;
  readonly enum: boolean;
  readonly enumValues: boolean;
  readonly exportType: boolean;
  readonly readWriteMarkers: boolean;
  readonly rootTypes: boolean;
}

export const defaultTypeFlags: TypeFlags = {
  arrayLength: true,
  conditionalEnums: false,
  dedupeEnums: false,
  enum: false,
  enumValues: false,
  exportType: false,
  readWriteMarkers: false,
  rootTypes: false,
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
  arrayLength: Flag.Boolean("array-length").pipe(
    Flag.withDescription("Generate tuples using array minItems / maxItems."),
    Flag.withDefault(true),
  ),
  rootTypes: flag("root-types", "Export component and operation types at the root level."),
  readWriteMarkers: flag(
    "read-write-markers",
    "Generate $Read/$Write markers for readOnly/writeOnly properties.",
  ),
};

export function pluginOptions(flags: TypeFlags & { readonly silent?: boolean }) {
  return {
    arrayLength: flags.arrayLength,
    conditionalEnums: flags.conditionalEnums,
    dedupeEnums: flags.dedupeEnums,
    enum: flags.enum,
    enumValues: flags.enumValues,
    exportType: flags.exportType,
    readWriteMarkers: flags.readWriteMarkers,
    rootTypes: flags.rootTypes,
    silent: flags.silent ?? false,
  };
}
