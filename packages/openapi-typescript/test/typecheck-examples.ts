import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exampleList, typesPath } from "./examples/manifest.js";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

const files = exampleList.flatMap((example) =>
  example.typecheck === false ? [] : example.variants.map((variant) => typesPath(example, variant)),
);

const config = {
  extends: path.join(packageRoot, "tsconfig.json"),
  compilerOptions: { noEmit: true, skipLibCheck: true },
  files,
};

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openapi-examples-"));
const configPath = path.join(directory, "tsconfig.json");
fs.writeFileSync(configPath, JSON.stringify(config));

execFileSync("bunx", ["tsc", "-p", configPath, "--pretty", "false"], {
  cwd: packageRoot,
  stdio: "inherit",
});
