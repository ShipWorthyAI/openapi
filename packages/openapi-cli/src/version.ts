import { readFileSync } from "node:fs";
import { Schema } from "effect";

const PackageJson = Schema.Struct({ version: Schema.String });

export const version = Schema.decodeSync(Schema.fromJsonString(PackageJson))(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;
