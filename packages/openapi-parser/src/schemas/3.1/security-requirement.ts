import { Schema } from "effect";

export const OpenApiSecurityRequirement = Schema.Record(Schema.String, Schema.Array(Schema.String));

export type OpenApiSecurityRequirement = typeof OpenApiSecurityRequirement.Type;
