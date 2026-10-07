import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { multiFile, singleFile } from "./schemas.js";
import { spawn } from "./spawn.js";

async function generateSchemas() {
  const cwd = fileURLToPath(new URL("../", import.meta.url));
  const singleFileSchemas = Object.entries(singleFile);
  const multiFileSchemas = Object.entries(multiFile);

  const schemaTotalCount = singleFileSchemas.length + multiFileSchemas.length;
  let schemasDoneCount = 0;

  const updateSchema = async (name: string, ext: string) => {
    const start = performance.now();

    try {
      const args: string[][] = [[`./examples/${name}${ext}`, "-o", `./examples/${name}.ts`]];

      // addiitonal flag tests (only for GitHub API, arbitrarily-chosen so we don’t have too much noise)
      if (name === "github-api") {
        args.push([
          `./examples/${name}${ext}`,
          "--immutable",
          "-o",
          `./examples/${name}-immutable.ts`,
        ]);

        args.push([
          `./examples/${name}${ext}`,
          "--immutable",
          "--export-type",
          "-o",
          `./examples/${name}-export-type-immutable.ts`,
        ]);

        args.push([
          `./examples/${name}${ext}`,
          "--properties-required-by-default",
          "-o",
          `./examples/${name}-required.ts`,
        ]);

        args.push([
          `./examples/${name}${ext}`,
          "--root-types",
          "-o",
          `./examples/${name}-root-types.ts`,
        ]);
      }

      const cli = fileURLToPath(new URL("../../openapi-cli/src/bin.ts", import.meta.url));
      await Promise.all(
        args.map((a) => spawn(["bun", cli, "generate", "typescript", ...a], { cwd })),
      );

      schemasDoneCount++;
      const timeMs = Math.round(performance.now() - start);

      // biome-ignore lint/suspicious/noConsole: this is a script
      console.log(`✔︎ [${schemasDoneCount}/${schemaTotalCount}] Updated ${name} (${timeMs}ms)`);
    } catch (error) {
      // biome-ignore lint/suspicious/noConsole: this is a script
      console.error(`✘ [${schemasDoneCount}/${schemaTotalCount}] Failed to update ${name}`, {
        error: error instanceof Error ? error.message : error,
      });
    }
  };

  // biome-ignore lint/suspicious/noConsole: this is a script
  console.log("Updating examples...");

  await Promise.all([
    ...singleFileSchemas.map(async ([name, url]) => {
      const ext = path.extname(url);
      await updateSchema(name, ext);
    }),
    ...multiFileSchemas.map(async ([name, meta]) => {
      const ext = meta.entry.substring(1);
      await updateSchema(name, ext);
    }),
  ]);

  // biome-ignore lint/suspicious/noConsole: this is a script
  console.log("Updating examples done.");
  process.exit(0); // helps process close in npm script
}

generateSchemas();
