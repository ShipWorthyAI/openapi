import { describe, expect, it } from "vitest";
import $RefParser, { oas3BundleOptions } from "../../../lib/index.js";
import path from "../../utils/path.js";

describe("OpenAPI 3 bundle roots", () => {
  const root = path.rel("test/specs/bundle-openapi/root.yaml");

  it("hoists external refs into OpenAPI component maps", async () => {
    const bundled = await $RefParser.bundle(root, { bundle: oas3BundleOptions() });
    const document = bundled as any;

    expect(document.paths["/pets"].get.parameters[0].$ref).to.equal("#/components/parameters/Limit");
    expect(document.components.parameters.Limit).to.deep.equal({
      name: "limit",
      in: "query",
      schema: { type: "integer" },
    });

    expect(document.paths["/pets"].get.responses["201"].$ref).to.equal("#/components/responses/Created");
    expect(document.components.responses.Created.description).to.equal("created");

    expect(document.paths["/pets"].post.requestBody.$ref).to.equal("#/components/requestBodies/Pet-body");
    expect(document.components.requestBodies["Pet-body"].required).to.equal(true);

    expect(document.paths["/pets"].get.responses["200"].headers["X-Rate"].$ref).to.equal("#/components/headers/Rate");
    expect(document.components.headers.Rate.schema).to.deep.equal({ type: "integer" });

    expect(document.paths["/pets"].get.responses["200"].content["application/json"].schema.$ref).to.equal(
      "#/components/schemas/Pet",
    );
    expect(document.components.schemas.Pet.properties.owner.$ref).to.equal("#/components/schemas/Owner");
    expect(document.components.schemas.Owner.properties.id).to.deep.equal({ type: "string" });

    expect(document.paths["/pets"].put.responses["200"].content["application/json"].schema.$ref).to.equal(
      "#/components/schemas/Pet_2",
    );
    expect(document.components.schemas.Pet_2.properties.sku).to.deep.equal({ type: "string" });

    expect(document.paths["/pets"].get.responses["200"].content["application/json"].examples.sample.$ref).to.equal(
      "#/components/examples/Pet-example",
    );
    expect(document.components.examples["Pet-example"].value).to.deep.equal({ name: "Rex" });

    expect(document.paths["/pets"].post.responses["200"].links.next.$ref).to.equal("#/components/links/Pet-link");
    expect(document.components.links["Pet-link"].operationId).to.equal("getPet");

    expect(document.paths["/pets"].post.callbacks.onPet.$ref).to.equal("#/components/callbacks/Pet-callback");
    expect(document.components.callbacks["Pet-callback"]["{$request.body#/id}"].post.responses["200"].description).to.equal(
      "ok",
    );

    expect(document.components.securitySchemes.ApiKey).to.deep.equal({
      type: "apiKey",
      name: "X-Api-Key",
      in: "header",
    });
    expect(document.paths["/pets"].post.responses["200"].content["application/json"].schema.$ref).to.equal(
      "#/components/schemas/Local",
    );
    expect(document.components.schemas.Local).to.deep.equal({ type: "string" });
  });

  it("leaves the default bundle inline when OpenAPI roots are not requested", async () => {
    const bundled = (await $RefParser.bundle(root)) as any;
    expect(bundled.components.schemas.Pet).to.equal(undefined);
    expect(bundled.paths["/pets"].get.responses["200"].content["application/json"].schema).to.deep.include({
      type: "object",
    });
  });
});
