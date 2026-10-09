import { describe, expect, it } from "vitest";
import { bundle, parse } from "./reference-engine.ts";

const document = { openapi: "3.1.0", info: { title: "Arguments", version: "1" }, paths: {} };

describe("reference engine arguments", () => {
  it("decodes document and path/document forms with omitted options", async () => {
    for (const args of [
      [document],
      ["/specs/root.json", document],
      ["/specs/root.json", document, undefined],
    ]) {
      expect(await bundle(...args)).toMatchObject(document);
    }
  });

  it("rejects malformed options rather than treating them as a document", async () => {
    for (const options of [
      { keepUrlRefs: "yes" },
      { resolve: { file: "no" } },
      { resolve: { http: { timeout: "soon" } } },
      { resolve: { http: { timeout: Infinity } } },
      { parsers: [{ canParse: () => true, parse: "invalid" }] },
    ]) {
      await expect(parse(document, options)).rejects.toMatchObject({ _tag: "SchemaError" });
    }

    await expect(parse("mem://root.json", { resolve: { file: "no" } })).rejects.toMatchObject({
      _tag: "SchemaError",
    });
  });

  it("preserves stateful resolver instances when decoding options", async () => {
    class Resolver {
      readonly order = 0;
      canRead() {
        return true;
      }
      read() {
        return JSON.stringify(this.source());
      }
      source() {
        return document;
      }
    }

    expect(
      await parse("mem://root.json", {
        resolve: { file: false, http: false },
        resolvers: [new Resolver()],
      }),
    ).toMatchObject(document);
  });
});
