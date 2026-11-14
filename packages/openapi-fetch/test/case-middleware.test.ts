import { expect, it } from "vitest";
import createClient from "../src/index.ts";
import {
  createCaseMappingMiddleware,
  type CaseMapping,
} from "../src/middleware/transform-casing.ts";

type Paths = {
  "/things/{thing_id}": {
    post: {
      parameters: {
        path: { thingId: string };
        query?: { includeDetails?: boolean };
        header?: { requestId?: string };
        cookie?: { sessionId?: string };
      };
      requestBody: { content: { "application/json": { guestInfo: { firstName: string } } } };
      responses: {
        201: {
          content: { "application/json": { thingId: string; guestInfo: { firstName: string } } };
        };
      };
    };
  };
};

const mapping = {
  operations: {
    "POST /things/{thing_id}": {
      parameters: {
        path: { properties: { thing_id: { name: "thingId" } } },
        query: { properties: { include_details: { name: "includeDetails" } } },
        header: { properties: { request_id: { name: "requestId" } } },
        cookie: { properties: { session_id: { name: "sessionId" } } },
      },
      requestBodies: {
        "application/json": {
          properties: {
            guest_info: {
              name: "guestInfo",
              schema: { properties: { first_name: { name: "firstName" } } },
            },
          },
        },
      },
      responses: {
        "201": {
          "application/json": {
            properties: {
              thing_id: { name: "thingId" },
              guest_info: {
                name: "guestInfo",
                schema: { properties: { first_name: { name: "firstName" } } },
              },
            },
          },
        },
      },
    },
  },
} satisfies CaseMapping;

it("installs case mapping from client options and preserves its Response", async () => {
  const response = Response.json(
    { thing_id: "t_1", guest_info: { first_name: "Ada" } },
    { status: 201 },
  );

  const rawResponse = response.clone();
  const requests: Request[] = [];

  const client = createClient<Paths>({
    baseUrl: "https://api.test",
    caseMapping: mapping,
    fetch: async (request) => {
      requests.push(request);
      return response;
    },
  });

  const input = {
    params: {
      path: { thingId: "t_1" },
      query: { includeDetails: true },
      header: { requestId: "r_1" },
      cookie: { sessionId: "s_1" },
    },
    body: { guestInfo: { firstName: "Ada" } },
  };

  const result = await client.POST("/things/{thing_id}", input);

  expect(requests[0]?.url).toBe("https://api.test/things/t_1?include_details=true");
  expect(requests[0]?.headers.get("request_id")).toBe("r_1");
  expect(requests[0]?.headers.get("Cookie")).toBe("session_id=s_1");
  expect(await requests[0]?.json()).toEqual({ guest_info: { first_name: "Ada" } });
  expect(result.data).toEqual({ thingId: "t_1", guestInfo: { firstName: "Ada" } });
  expect(result.response).toBe(response);
  expect(await rawResponse.json()).toEqual({ thing_id: "t_1", guest_info: { first_name: "Ada" } });
  expect(input.body).toEqual({ guestInfo: { firstName: "Ada" } });
});

it("leaves non-JSON success parsing alone while mapping parsed JSON errors", async () => {
  type ResultPaths = {
    "/result": {
      get: {
        responses: {
          200: { content: { "application/json": { guestId: string } } };
          400: { content: { "application/problem+json": { errorCode: string } } };
        };
      };
    };
  };

  const resultMapping = {
    operations: {
      "GET /result": {
        responses: {
          "200": { "application/json": { properties: { guest_id: { name: "guestId" } } } },
          "400": {
            "application/problem+json": { properties: { error_code: { name: "errorCode" } } },
          },
        },
      },
    },
  } satisfies CaseMapping;

  const responses = [
    Response.json({ guest_id: "g_1" }),
    Response.json(
      { error_code: "invalid_guest" },
      { status: 400, headers: { "Content-Type": "application/problem+json" } },
    ),
  ];

  const client = createClient<ResultPaths>({
    baseUrl: "https://api.test",
    fetch: async () => {
      const response = responses.shift();
      if (!response) throw new Error("Unexpected request");
      return response;
    },
  });

  client.use(createCaseMappingMiddleware(resultMapping));

  const success = await client.GET("/result", { parseAs: "text" });
  expect(success.data).toBe('{"guest_id":"g_1"}');

  const failure = await client.GET("/result", { parseAs: "text" });
  expect(failure.error).toEqual({ errorCode: "invalid_guest" });
});

it("maps JSON objects parsed in another realm and leaves non-plain objects alone", async () => {
  class Tag {
    constructor(readonly tag_name: string) {}
  }

  const createdAt = new Date("2026-01-01T00:00:00Z");
  const tag = new Tag("vip");

  // Another realm's Object.prototype: a distinct object whose own prototype is null, as seen
  // by `response.json()` under Jest, which runs tests in a vm context with Node's outer fetch.
  const realmObjectPrototype: object = Object.create(null);

  const fromRealm = (fields: object): object =>
    Object.assign(Object.create(realmObjectPrototype), fields);

  const body = fromRealm({
    thing_id: "t_1",
    guest_info: fromRealm({ first_name: "Ada" }),
    created_at: createdAt,
    tag,
  });

  const objectMapping = {
    operations: {
      "POST /things/{thing_id}": {
        responses: {
          "201": {
            "application/json": {
              properties: {
                ...mapping.operations["POST /things/{thing_id}"].responses["201"][
                  "application/json"
                ].properties,
                created_at: {
                  name: "createdAt",
                  schema: { properties: { time_zone: { name: "timeZone" } } },
                },
                tag: { name: "tag", schema: { properties: { tag_name: { name: "tagName" } } } },
              },
            },
          },
        },
      },
    },
  } satisfies CaseMapping;

  const response = new Response("{}", {
    status: 201,
    headers: { "Content-Type": "application/json", "Content-Length": "2" },
  });

  response.json = async () => body;

  const client = createClient<Paths>({
    baseUrl: "https://api.test",
    caseMapping: objectMapping,
    fetch: async () => response,
  });

  const result = await client.POST("/things/{thing_id}", {
    params: { path: { thingId: "t_1" } },
    body: { guestInfo: { firstName: "Ada" } },
  });

  expect(result.data).toEqual({
    thingId: "t_1",
    guestInfo: { firstName: "Ada" },
    createdAt,
    tag,
  });

  const data: object = result.data ?? {};
  expect(Reflect.get(data, "createdAt")).toBe(createdAt);
  expect(Reflect.get(data, "tag")).toBe(tag);
});

it("runs case mapping innermost so other middleware works with app-facing names", async () => {
  const requests: Request[] = [];
  const seen: unknown[] = [];

  const client = createClient<Paths>({
    baseUrl: "https://api.test",
    caseMapping: mapping,
    fetch: async (request) => {
      requests.push(request);

      return Response.json({ thing_id: "t_1", guest_info: { first_name: "Ada" } }, { status: 201 });
    },
  });

  client.use({
    onRequestInit({ input }) {
      seen.push(input.body);
      return { ...input, body: { guestInfo: { firstName: "Grace" } } };
    },
    onResult({ result }) {
      seen.push(result.data);
    },
  });

  const result = await client.POST("/things/{thing_id}", {
    params: { path: { thingId: "t_1" } },
    body: { guestInfo: { firstName: "Ada" } },
  });

  expect(seen).toEqual([
    { guestInfo: { firstName: "Ada" } },
    { thingId: "t_1", guestInfo: { firstName: "Ada" } },
  ]);

  expect(await requests[0]?.json()).toEqual({ guest_info: { first_name: "Grace" } });
  expect(result.data).toEqual({ thingId: "t_1", guestInfo: { firstName: "Ada" } });
});

it("retries a call from onResult with new headers and returns the retried result", async () => {
  const operation = mapping.operations["POST /things/{thing_id}"];

  const retryMapping = {
    operations: {
      "POST /things/{thing_id}": {
        ...operation,
        responses: {
          ...operation.responses,
          "409": { "application/json": { properties: { sign_in_url: { name: "signInUrl" } } } },
        },
      },
    },
  } satisfies CaseMapping;

  const requests: Request[] = [];
  const attempts: number[] = [];
  const outer: unknown[] = [];

  const client = createClient<Paths>({
    baseUrl: "https://api.test",
    caseMapping: retryMapping,
    headers: { "X-Client": "app" },
    fetch: async (request) => {
      requests.push(request.clone());

      return request.headers.has("X-Token")
        ? Response.json({ thing_id: "t_1", guest_info: { first_name: "Ada" } }, { status: 201 })
        : Response.json({ sign_in_url: "https://sign-in.test" }, { status: 409 });
    },
  });

  // Registered first, so its onResult runs after the retrying hook's.
  client.use({
    onResult({ result }) {
      outer.push(result.data ?? result.error);
    },
  });

  client.use({
    async onResult({ result, attempt, retry }) {
      attempts.push(attempt);

      // The error arrives with app-facing names.
      if (
        attempt > 0 ||
        !Object.is(Reflect.get(Object(result.error), "signInUrl"), "https://sign-in.test")
      ) {
        return undefined;
      }

      return retry({
        headers: { "X-Token": "signed-in", "Idempotency-Key": "key-2", "X-Client": null },
      });
    },
  });

  const result = await client.POST("/things/{thing_id}", {
    params: { path: { thingId: "t_1" } },
    headers: { "Idempotency-Key": "key-1" },
    body: { guestInfo: { firstName: "Ada" } },
  });

  expect(attempts).toEqual([0, 1]);
  expect(requests).toHaveLength(2);
  expect(requests[0]?.headers.get("Idempotency-Key")).toBe("key-1");
  expect(requests[0]?.headers.get("X-Client")).toBe("app");
  expect(requests[1]?.headers.get("Idempotency-Key")).toBe("key-2");
  expect(requests[1]?.headers.get("X-Token")).toBe("signed-in");
  expect(requests[1]?.headers.has("X-Client")).toBe(false);
  expect(await requests[1]?.json()).toEqual({ guest_info: { first_name: "Ada" } });
  expect(result.error).toBeUndefined();
  expect(result.data).toEqual({ thingId: "t_1", guestInfo: { firstName: "Ada" } });
  expect(result.response.status).toBe(201);

  // The retried call ran every hook itself; the original call's remaining hooks see its result.
  expect(outer).toEqual([
    { thingId: "t_1", guestInfo: { firstName: "Ada" } },
    { thingId: "t_1", guestInfo: { firstName: "Ada" } },
  ]);
});

it("rejects a replaced response that did not come from retry", async () => {
  const client = createClient<Paths>({
    baseUrl: "https://api.test",
    fetch: async () => Response.json({}, { status: 201 }),
  });

  client.use({
    onResult: ({ result }) => ({ ...result, response: new Response(null, { status: 204 }) }),
  });

  await expect(
    client.POST("/things/{thing_id}", {
      params: { path: { thingId: "t_1" } },
      body: { guestInfo: { firstName: "Ada" } },
    }),
  ).rejects.toThrow("onResult: must return data and/or error when modifying the result");
});
