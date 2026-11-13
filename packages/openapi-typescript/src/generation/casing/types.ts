export interface CaseSchema {
  readonly ref?: string;
  readonly properties?: Readonly<
    Record<string, { readonly name: string; readonly schema?: CaseSchema }>
  >;
  readonly declared?: readonly string[];
  readonly items?: CaseSchema;
  readonly prefixItems?: readonly (CaseSchema | null)[];
  readonly additionalProperties?: CaseSchema;
  readonly patternProperties?: Readonly<Record<string, CaseSchema | null>>;
  readonly variants?: readonly CaseSchema[];
}

export type CaseMediaMap = Readonly<Record<string, CaseSchema | null>>;

export interface CaseOperation {
  readonly parameters?: Readonly<
    Partial<Record<"path" | "query" | "header" | "cookie", CaseSchema>>
  >;
  readonly requestBodies?: CaseMediaMap;
  readonly responses?: Readonly<Record<string, CaseMediaMap | null>>;
}

export interface CaseMapping {
  readonly schemas?: Readonly<Record<string, CaseSchema>>;
  readonly operations?: Readonly<Record<string, CaseOperation>>;
}
