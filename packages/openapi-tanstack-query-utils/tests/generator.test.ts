import { generateSchema } from "../src/generator";
import { schema } from "./fixtures";
import { generatedFixture } from "./generated-fixture";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const cli = resolve(import.meta.dirname, "../src/cli.ts");
const generate = (input: string, output: string) =>
  exec("bun", ["run", cli, input, "-o", output, "--name", "fixture"]);

test("CLI generates a typed route table from local and remote referenced documents", async () => {
  const directory = await mkdtemp(resolve(import.meta.dirname, ".generation-"));
  const document = structuredClone(schema) as any;
  document.components.schemas.Item = { $ref: "./item.json" };
  const item = {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string" } },
  };
  await writeFile(resolve(directory, "schema.json"), JSON.stringify(document));
  await writeFile(resolve(directory, "item.json"), JSON.stringify(item));
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(req.url === "/item.json" ? item : document));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await generate(resolve(directory, "schema.json"), directory);
    const local = await readFile(resolve(directory, "fixture/client.ts"), "utf8");
    assert.match(local, /createFixtureApiQueryUtils/);
    assert.match(local, /"getItem": \["GET","\/items\/\{id\}"\]/);
    assert.ok(!local.includes("async run"));
    assert.ok(!local.includes("createOperation"));
    assert.ok(!local.includes("useApiClient"));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await generate(`http://127.0.0.1:${address.port}/schema.json`, directory);
    assert.equal(await readFile(resolve(directory, "fixture/client.ts"), "utf8"), local);
    await writeFile(
      resolve(directory, "consumer.ts"),
      `
      import { createFixtureApiClient, createFixtureApiQueryUtils } from './fixture/client';
      import { useQuery, useMutation, useSuspenseQuery, QueryClient } from '@tanstack/react-query';
      const utils = createFixtureApiQueryUtils(createFixtureApiClient({baseUrl: 'http://test'}));
      useQuery(utils.getItem.queryOptions({ input: { path: { id: '1' }, query: { tags: ['one'] } }, select: item => item.name }));
      const item: string = useSuspenseQuery(utils.getItem.queryOptions({input: {path: {id: '1'}}})).data.name;
      useMutation(utils.updateItem.mutationOptions()).mutate({path: {id:'1'},body:{name:'Hotel'},header:{'Idempotency-Key':'attempt'}});
      // @ts-expect-error Missing request header.
      useMutation(utils.updateItem.mutationOptions()).mutate({input: {id:'1',name:'Hotel'}});
      // @ts-expect-error Missing inherited path parameter.
      utils.getItem.queryOptions({input:{}});
      new QueryClient().setQueryData(utils.getItem.queryKey({input:{path:{id:'1'}}}), old => old && {name:old.name});
    `,
    );
    for (const compiler of [
      resolve(import.meta.dirname, "../node_modules/typescript/bin/tsc"),
      resolve(import.meta.dirname, "../../../node_modules/typescript/bin/tsc"),
    ]) {
      await exec(process.execPath, [
        compiler,
        "--ignoreConfig",
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--target",
        "ES2022",
        "--module",
        "ESNext",
        "--moduleResolution",
        "bundler",
        resolve(directory, "consumer.ts"),
      ]);
    }
    document.paths["/items/{id}"].get.operationId = "listItems";
    await writeFile(resolve(directory, "schema.json"), JSON.stringify(document));
    await assert.rejects(
      generate(resolve(directory, "schema.json"), directory),
      /unique `operationId`/,
    );
    assert.equal(await readFile(resolve(directory, "fixture/client.ts"), "utf8"), local);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});

test("generator requires operation IDs without inspecting body schemas", async () => {
  const missing = structuredClone(schema) as any;
  delete missing.paths["/items"].get.operationId;
  await assert.rejects(generateSchema(missing), /GET \/items: Missing operationId/);
  const arrays = structuredClone(schema) as any;
  arrays.paths["/items/{id}"].post.requestBody.content["application/json"].schema = {
    type: "array",
    items: { type: "string" },
  };
  const { routes } = await generateSchema(arrays);
  assert.deepEqual(routes.updateItem, ["POST", "/items/{id}"]);
});

test("grouped inputs preserve distinct path/query/body fields and native body shapes", async () => {
  const document = structuredClone(schema) as any;
  const operation = document.paths["/items/{id}"].post;
  operation.parameters.push({
    name: "id",
    in: "query",
    schema: { type: "string" },
  });
  operation.requestBody = {
    required: false,
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: { id: { type: "number" } },
          additionalProperties: true,
        },
      },
    },
  };
  const fixture = await generatedFixture(document);
  let request: Request | undefined;
  try {
    const client = fixture.createFixtureApiClient({
      baseUrl: "http://test",
      fetch: async (value) => {
        request = value;
        return new Response(null, { status: 204 });
      },
    });
    const mutation = fixture
      .createFixtureApiQueryUtils(client)
      .updateItem.mutationOptions().mutationFn;
    await mutation({
      path: { id: "path-id" },
      query: { id: "query-id" },
      body: { id: 42, extra: "value" },
      header: { "Idempotency-Key": "attempt" },
    } as any);
    assert.equal(request!.url, "http://test/items/path-id?id=query-id");
    assert.deepEqual(await request!.json(), { id: 42, extra: "value" });
    await mutation({
      path: { id: "1" },
      header: { "Idempotency-Key": "attempt" },
    } as any);
    assert.equal(await request!.text(), "");
    await mutation({
      path: { id: "1" },
      body: {},
      header: { "Idempotency-Key": "attempt" },
    } as any);
    assert.equal(await request!.text(), "{}");
  } finally {
    await fixture.dispose();
  }
  operation.requestBody.content["application/json"].schema = {
    type: "array",
    items: { type: "string" },
  };
  operation.responses = {
    "201": {
      description: "Created",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: { created: { type: "boolean" } },
          },
        },
      },
    },
  };
  const arrayFixture = await generatedFixture(document);
  try {
    const client = arrayFixture.createFixtureApiClient({
      baseUrl: "http://test",
      fetch: async (value) => {
        request = value;
        return new Response(JSON.stringify({ created: true }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    const mutation = arrayFixture
      .createFixtureApiQueryUtils(client)
      .updateItem.mutationOptions().mutationFn;
    const result = await mutation({
      path: { id: "1" },
      body: ["one", "two"],
      header: { "Idempotency-Key": "attempt" },
    } as any);
    assert.deepEqual(await request!.json(), ["one", "two"]);
    assert.deepEqual(result, { created: true });
  } finally {
    await arrayFixture.dispose();
  }
});

test("schema-less operations and referenced path items use the same generation path", async () => {
  const document = {
    openapi: "3.0.3",
    info: { title: "Empty responses", version: "1" },
    paths: {
      "/health": {
        get: {
          operationId: "health",
          responses: { 204: { description: "OK" } },
        },
      },
      "/ready": { $ref: "#/components/pathItems/Ready" },
    },
    components: {
      pathItems: {
        Ready: {
          get: {
            operationId: "ready",
            responses: { 204: { description: "OK" } },
          },
        },
      },
    },
  };
  const { routes } = await generateSchema(document);
  assert.deepEqual(
    { ...routes },
    {
      health: ["GET", "/health"],
      ready: ["GET", "/ready"],
    },
  );
  const empty = await generateSchema({
    openapi: "3.0.3",
    info: document.info,
    paths: {},
  });
  assert.deepEqual(Object.keys(empty.routes), []);
});

test("schema-less operations still require an operationId", async () => {
  await assert.rejects(
    generateSchema({
      openapi: "3.0.3",
      info: { title: "Missing ID", version: "1" },
      paths: {
        "/health": { get: { responses: { 204: { description: "OK" } } } },
      },
    }),
    /GET \/health: Missing operationId/,
  );
});
