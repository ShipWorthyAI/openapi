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
