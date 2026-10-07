import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { exampleList, flagsToOptions, schemaPath, typesPath } from "./examples/manifest.js";
import { render } from "./render.js";

const SLOW = new Set(["github", "github-next", "stripe", "octokit-ghes-3.6", "digital-ocean"]);

describe("examples", () => {
  for (const example of exampleList) {
    for (const variant of example.variants) {
      it.effect(
        `${example.id} > ${variant.id}`,
        () =>
          Effect.gen(function* () {
            const output = yield* render(
              pathToFileURL(schemaPath(example)),
              flagsToOptions(variant.flags),
            );

            expect(output).toBe(fs.readFileSync(typesPath(example, variant), "utf8"));
          }),
        SLOW.has(example.id) ? 120_000 : 30_000,
      );
    }
  }
});
