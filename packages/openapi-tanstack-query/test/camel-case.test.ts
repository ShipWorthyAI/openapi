import { decode } from "@shipworthy/openapi-transformer";
import { buildCaseMapping } from "@shipworthy/openapi-typescript/case-mapping";
import { Effect } from "effect";
import { expect, expectTypeOf, it } from "vitest";
import { tanstackQuery } from "../src/generator.ts";
import { createApiClient, createTanstackQueryUtils } from "../src/index.ts";

interface Guest {
  guestId: string;
  firstName: string;
}

interface Reservation {
  reservationId: string;
  guestList: Guest[];
  attributes: Record<string, Guest>;
}

type CreateReservation = {
  parameters: {
    path: { reservationId: string };
    query?: { includeDetails?: boolean };
    header?: { requestId?: string };
  };
  requestBody: {
    content: {
      "application/json": {
        guestInfo: Guest;
        attributes: Record<string, Guest>;
      };
    };
  };
  responses: {
    201: { content: { "application/json": Reservation } };
    400: { content: { "application/problem+json": { errorCode: string } } };
  };
};

type Operations = { createReservation: CreateReservation };
type Paths = { "/reservations/{reservation_id}": { post: CreateReservation } };

const path = "/reservations/{reservation_id}";
const routes = { createReservation: ["POST", path] } as const;

const document = {
  openapi: "3.1.0",
  info: { title: "Reservations", version: "1" },
  paths: {
    [path]: {
      post: {
        operationId: "createReservation",
        parameters: [
          { name: "reservation_id", in: "path", required: true, schema: { type: "string" } },
          { name: "include_details", in: "query", schema: { type: "boolean" } },
          { name: "request_id", in: "header", schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["guest_info", "attributes"],
                properties: {
                  guest_info: { $ref: "#/components/schemas/Guest" },
                  attributes: {
                    type: "object",
                    additionalProperties: { $ref: "#/components/schemas/Guest" },
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["reservation_id", "guest_list", "attributes"],
                  properties: {
                    reservation_id: { type: "string" },
                    guest_list: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Guest" },
                    },
                    attributes: {
                      type: "object",
                      additionalProperties: { $ref: "#/components/schemas/Guest" },
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Bad request",
            content: {
              "application/problem+json": {
                schema: {
                  type: "object",
                  properties: { error_code: { type: "string" } },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Guest: {
        type: "object",
        required: ["guest_id", "first_name"],
        properties: {
          guest_id: { type: "string" },
          first_name: { type: "string" },
        },
      },
    },
  },
} as const;

it("converts typed parameters, JSON bodies, success data, and errors from the parsed schema", async () => {
  const model = Effect.runSync(decode(document));
  const mapping = Effect.runSync(buildCaseMapping(model));
  const requests: Request[] = [];

  const client = createApiClient<Paths>({
    baseUrl: "https://api.example.test",
    fetch: async (request) => {
      requests.push(request);

      return Response.json(
        {
          reservation_id: "r_1",
          guest_list: [{ guest_id: "g_1", first_name: "Ada" }],
          attributes: { custom_id: { guest_id: "g_2", first_name: "Lin" } },
        },
        { status: 201 },
      );
    },
    caseMapping: mapping,
  });

  const api = createTanstackQueryUtils<Operations>(client, routes, { prefix: "reservations" });

  const input = {
    path: { reservationId: "r_1" },
    query: { includeDetails: true },
    header: { requestId: "req_1" },
    body: {
      guestInfo: { guestId: "g_1", firstName: "Ada" },
      attributes: { custom_id: { guestId: "g_2", firstName: "Lin" } },
    },
  };

  const mutation = api.createReservation.mutationOptions();
  expectTypeOf(mutation.mutationFn).returns.resolves.toEqualTypeOf<Reservation>();

  expect(await mutation.mutationFn(input)).toEqual({
    reservationId: "r_1",
    guestList: [{ guestId: "g_1", firstName: "Ada" }],
    attributes: { custom_id: { guestId: "g_2", firstName: "Lin" } },
  });

  expect(api.createReservation.key({ input })).toEqual([
    "reservations",
    "createReservation",
    { input: { ...input, header: { requestid: "req_1" } } },
  ]);

  const direct = await client.POST(path, { params: { path: input.path }, body: input.body });
  expect(direct.data?.reservationId).toBe("r_1");
  expect(requests).toHaveLength(2);
  expect(requests[0]?.url).toBe("https://api.example.test/reservations/r_1?include_details=true");
  expect(requests[0]?.headers.get("request_id")).toBe("req_1");

  expect(await requests[0]?.json()).toEqual({
    guest_info: { guest_id: "g_1", first_name: "Ada" },
    attributes: { custom_id: { guest_id: "g_2", first_name: "Lin" } },
  });
});

it("converts documented JSON errors", async () => {
  const mapping = Effect.runSync(buildCaseMapping(Effect.runSync(decode(document))));

  const client = createApiClient<Paths>({
    baseUrl: "https://api.example.test",
    fetch: async () =>
      Response.json(
        { error_code: "invalid_guest" },
        { status: 400, headers: { "Content-Type": "application/problem+json" } },
      ),
    caseMapping: mapping,
  });

  const api = createTanstackQueryUtils<Operations>(client, routes, { prefix: "reservations" });

  await expect(
    api.createReservation.mutationOptions().mutationFn({
      path: { reservationId: "r_1" },
      body: {
        guestInfo: { guestId: "g_1", firstName: "Ada" },
        attributes: {},
      },
    }),
  ).rejects.toEqual({ errorCode: "invalid_guest" });
});

it("keeps declared keys out of additionalProperties conversion", async () => {
  const model = Effect.runSync(
    decode({
      openapi: "3.1.0",
      info: { title: "Metadata", version: "1" },
      paths: {
        "/metadata": {
          get: {
            operationId: "getMetadata",
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: { fixed: { type: "object", additionalProperties: true } },
                      additionalProperties: {
                        type: "object",
                        properties: { first_name: { type: "string" } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
  );

  const mapping = Effect.runSync(buildCaseMapping(model));

  const client = createApiClient<{
    "/metadata": {
      get: {
        responses: { 200: { content: { "application/json": Record<string, unknown> } } };
      };
    };
  }>({
    baseUrl: "https://api.example.test",
    fetch: async () =>
      Response.json({ fixed: { first_name: "leave" }, dynamic: { first_name: "convert" } }),
    caseMapping: mapping,
  });

  expect((await client.GET("/metadata")).data).toEqual({
    fixed: { first_name: "leave" },
    dynamic: { firstName: "convert" },
  });
});

it("keeps no-op pattern properties when a composed branch converts additional values", async () => {
  const model = Effect.runSync(
    decode({
      openapi: "3.1.0",
      info: { title: "Metadata", version: "1" },
      paths: {
        "/metadata": {
          get: {
            operationId: "getMetadata",
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: {
                      allOf: [
                        { $ref: "#/components/schemas/Patterned" },
                        { $ref: "#/components/schemas/Dynamic" },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Patterned: {
            type: "object",
            patternProperties: { "^fixed_": { type: "object" } },
          },
          Dynamic: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: { first_name: { type: "string" } },
            },
          },
        },
      },
    }),
  );

  const mapping = Effect.runSync(buildCaseMapping(model));

  const client = createApiClient<{
    "/metadata": {
      get: {
        responses: { 200: { content: { "application/json": Record<string, unknown> } } };
      };
    };
  }>({
    baseUrl: "https://api.example.test",
    fetch: async () =>
      Response.json({
        fixed_key: { first_name: "leave" },
        dynamic_key: { first_name: "convert" },
      }),
    caseMapping: mapping,
  });

  expect((await client.GET("/metadata")).data).toEqual({
    fixed_key: { first_name: "leave" },
    dynamic_key: { firstName: "convert" },
  });
});

it("converts discriminator fields on directly returned variants", async () => {
  const model = Effect.runSync(
    decode({
      openapi: "3.1.0",
      info: { title: "Animals", version: "1" },
      paths: {
        "/dogs": {
          get: {
            operationId: "getDog",
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": { schema: { $ref: "#/components/schemas/Dog" } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Animal: {
            oneOf: [{ $ref: "#/components/schemas/Dog" }],
            discriminator: {
              propertyName: "animal_type",
              mapping: { dog: "#/components/schemas/Dog" },
            },
          },
          Dog: {
            type: "object",
            properties: { dog_name: { type: "string" } },
          },
        },
      },
    }),
  );

  const mapping = Effect.runSync(buildCaseMapping(model));

  const client = createApiClient<{
    "/dogs": {
      get: {
        responses: {
          200: { content: { "application/json": { animalType: string; dogName: string } } };
        };
      };
    };
  }>({
    baseUrl: "https://api.example.test",
    fetch: async () => Response.json({ animal_type: "dog", dog_name: "Ada" }),
    caseMapping: mapping,
  });

  expect((await client.GET("/dogs")).data).toEqual({ animalType: "dog", dogName: "Ada" });
});

it("uses the effective Content-Type when converting a JSON mutation body", async () => {
  const model = Effect.runSync(
    decode({
      openapi: "3.1.0",
      info: { title: "Hotel updates", version: "1" },
      paths: {
        "/hotels": {
          patch: {
            operationId: "updateHotels",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { type: "object", properties: { name: { type: "string" } } },
                },
                "application/merge-patch+json": {
                  schema: { type: "object", properties: { hotel_id: { type: "string" } } },
                },
              },
            },
            responses: { "204": { description: "Updated" } },
          },
        },
      },
    }),
  );

  const mapping = Effect.runSync(buildCaseMapping(model));
  const bodies: unknown[] = [];

  const client = createApiClient<{
    "/hotels": {
      patch: {
        requestBody: {
          content: {
            "application/json": { name?: string };
            "application/merge-patch+json": { hotelId?: string };
          };
        };
        responses: { 204: { content?: never } };
      };
    };
  }>({
    baseUrl: "https://api.example.test",
    headers: { "Content-Type": "application/merge-patch+json" },
    fetch: async (request) => {
      bodies.push(await request.json());
      return new Response(null, { status: 204 });
    },
    caseMapping: mapping,
  });

  await client.PATCH("/hotels", { body: { hotelId: "h_1" } });

  await client.PATCH("/hotels", {
    headers: { "Content-Type": "application/json" },
    body: { hotelId: "h_2" },
  });

  expect(bodies).toEqual([{ hotel_id: "h_1" }, { hotelId: "h_2" }]);
});

it.each(["allOf", "oneOf"] as const)(
  "rejects ambiguous field names across %s request branches",
  (keyword) => {
    const model = Effect.runSync(
      decode({
        openapi: "3.1.0",
        info: { title: "Pets", version: "1" },
        paths: {
          "/pets": {
            post: {
              operationId: "createPet",
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: {
                      [keyword]: [
                        { type: "object", properties: { pet_id: { type: "string" } } },
                        { type: "object", properties: { petId: { type: "string" } } },
                      ],
                    },
                  },
                },
              },
              responses: { "204": { description: "Created" } },
            },
          },
        },
      }),
    );

    const generated = tanstackQuery.generate(model, { camelCase: true });

    const error = Effect.runSync(
      Effect.flip(Effect.isEffect(generated) ? generated : Effect.succeed(generated)),
    );

    expect(error.message).toContain("pet_id and petId both become petId");
  },
);

it("rejects conflicting nested fields shared by oneOf variants", () => {
  const model = Effect.runSync(
    decode({
      openapi: "3.1.0",
      info: { title: "Pets", version: "1" },
      paths: {
        "/pets": {
          post: {
            operationId: "createPet",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    oneOf: [
                      {
                        type: "object",
                        properties: {
                          payload: {
                            type: "object",
                            properties: { pet_id: { type: "string" } },
                          },
                        },
                      },
                      {
                        type: "object",
                        properties: {
                          payload: {
                            type: "object",
                            properties: { petId: { type: "string" } },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
            responses: { "204": { description: "Created" } },
          },
        },
      },
    }),
  );

  const generated = tanstackQuery.generate(model, { camelCase: true });

  const error = Effect.runSync(
    Effect.flip(Effect.isEffect(generated) ? generated : Effect.succeed(generated)),
  );

  expect(error.message).toContain("pet_id and petId both become petId");
});
