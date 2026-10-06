import {
  createApiClient,
  type ApiClient,
  type OperationQueryUtils,
  type TanstackQueryUtilsOptions,
} from "../src/index";
import type { ItemOperation, UpdateOperation, ListOperation } from "./fixtures";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { OpenAPI3 } from "@shipworthy/openapi-typescript";

type FixtureUtils = {
  getItem: OperationQueryUtils<ItemOperation>;
  updateItem: OperationQueryUtils<UpdateOperation>;
  listItems: OperationQueryUtils<ListOperation>;
};

/** Exercise the real generated handlers, not a second test-only mapper. */
export async function generatedFixture(schema: OpenAPI3) {
  const directory = await mkdtemp(resolve(import.meta.dirname, ".generated-"));
  const dispose = () => rm(directory, { recursive: true, force: true });
  try {
    await writeFile(resolve(directory, "schema.json"), JSON.stringify(schema));
    await promisify(execFile)("bun", [
      "run",
      resolve(import.meta.dirname, "../../openapi-cli/src/bin.ts"),
      "tanstack-query-utils",
      resolve(directory, "schema.json"),
      "-o",
      directory,
      "--name",
      "fixture",
    ]);
    const client = (await import(pathToFileURL(resolve(directory, "fixture/client.ts")).href)) as {
      createFixtureApiClient: typeof createApiClient;
      createFixtureApiQueryUtils: (
        client: ApiClient<any>,
        options?: Partial<TanstackQueryUtilsOptions>,
      ) => FixtureUtils;
    };
    return { ...client, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
