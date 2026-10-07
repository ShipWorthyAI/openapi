import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseYamlDocument } from "../src/yaml.js";

describe("YAML compatibility", () => {
  it("parses compact nested block sequences and negative numbers", () => {
    const parsed = parseYamlDocument(`value:
  - - 1302998400
    - 1124
    - -435
  - - 0
    - 1
    - 5
`);

    expect(parsed).toEqual({
      value: [
        [1302998400, 1124, -435],
        [0, 1, 5],
      ],
    });
  });

  it("leaves a dash-prefixed scalar inside a block scalar", () => {
    const parsed = parseYamlDocument(`description: |
  - - keep me
items:
  - - 1
    - 2
`) as { description: string; items: number[][] };

    expect(parsed.description).toBe("- - keep me\n");
    expect(parsed.items).toEqual([[1, 2]]);
  });

  it("parses a block scalar whose content shares the header indent", () => {
    const parsed = parseYamlDocument(`body:
  examples:
    - |2


    The MIT License

    Copyright
  featured: true
`) as { body: { examples: string[]; featured: boolean } };

    expect(parsed.body.examples).toEqual(["\n\nThe MIT License\n\nCopyright\n"]);
    expect(parsed.body.featured).toBe(true);
  });

  it("does not treat digits after > inside prose as a block indicator", () => {
    const parsed = parseYamlDocument(`description: >
      created (<a href="/docs/charges/placing-a-hold">7 by default</a>), after
      which they are marked as refunded.
`) as { description: string };

    expect(parsed.description).toContain(">7 by default</a>");
  });

  it("parses a tab inside a block scalar", () => {
    const parsed = parseYamlDocument("source: |-\n  line\n  \tkept\n") as { source: string };
    expect(parsed.source).toContain("kept");
  });

  it("applies a YAML merge key", () => {
    const fixture = path.resolve(
      import.meta.dirname,
      "../../openapi-typescript/test/fixtures/yaml-merge.yaml",
    );

    const parsed = parseYamlDocument(readFileSync(fixture, "utf8")) as {
      paths: { "/admin/ping": { get: { responses: Record<string, { description: string }> } } };
    };

    const responses = parsed.paths["/admin/ping"].get.responses;
    expect(Object.keys(responses)).toEqual(["200", "4XX"]);
    expect(responses["4XX"]?.description).toBe("Error response");
    expect(responses["200"]?.description).toBe("OK");
  });
});
