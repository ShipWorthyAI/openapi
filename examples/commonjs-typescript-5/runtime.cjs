const assert = require("node:assert/strict");
const { createApiClient, createTanstackQueryUtils } = require("@shipworthy/openapi-tanstack-query");

const client = createApiClient({
  baseUrl: "https://api.test",
  fetch: async (request) => {
    assert.equal(request.url, "https://api.test/pets");
    assert.equal(request.headers.get("Authorization"), "Bearer token");
    return Response.json({ data: [] });
  },
});

client.use({
  onRequest({ request }) {
    request.headers.set("Authorization", "Bearer token");
  },
});

const api = createTanstackQueryUtils(client, { listPets: ["GET", "/pets"] }, { prefix: "pets" });

api.listPets
  .queryOptions()
  .queryFn({ signal: new AbortController().signal })
  .then((data) => assert.deepEqual(data, { data: [] }));
