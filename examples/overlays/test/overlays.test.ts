import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, it } from "@effect/vitest";
import { bundleDocument } from "@shipworthy/openapi-parser";
import { OpenApiHttpMethod, ParsedOpenApi } from "@shipworthy/openapi-parser/schemas/3.1";
import { applyOverlay } from "@shipworthy/overlay";
import { Array, Effect, FileSystem, Layer, Order, Predicate, Record, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

const layer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, FetchHttpClient.layer);
const root = new URL("../", import.meta.url);

const examples = [
  {
    name: "nuitee/search",
    source: "openapi/nuitee/search.json",
    overlay: "overlays/nuitee/search.overlay.json",
    operations: ["searchHotelRates"],
  },
  {
    name: "nuitee/booking",
    source: "openapi/nuitee/booking.json",
    overlay: "overlays/nuitee/booking.overlay.json",
    operations: [
      "getPrebook",
      "createPrebook",
      "createBooking",
      "createRebooking",
      "listBookings",
      "getBooking",
      "cancelBooking",
      "amendBookingGuestName",
      "createAlternativePrebooks",
    ],
  },
  {
    name: "nuitee/hotel-data",
    source: "openapi/nuitee/hotel-data.json",
    overlay: "overlays/nuitee/hotel-data.overlay.json",
    operations: ["searchPlaces", "getPlace", "listHotels", "getHotel"],
  },
  {
    name: "core",
    source: "openapi/core/openapi.yaml",
    overlay: "overlays/core/core.overlay.json",
    operations: [
      "authorizeHotelPayment",
      "getHotelPayment",
      "finalizeHotelPayment",
      "releaseHotelPayment",
    ],
  },
];

it.effect.each(examples)(
  "$name bundles, applies every action, selects operations, and matches the CLI artifact",
  (example) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const source = yield* bundleDocument(new URL(example.source, root));
      const overlay = yield* fs.readFileString(fileURLToPath(new URL(example.overlay, root)));

      const result = yield* applyOverlay(source, overlay, {
        strictTargets: true,
        removeUnusedComponents: true,
      });

      const document = yield* Schema.decodeUnknownEffect(ParsedOpenApi)(result);

      const operationIds = Array.filter(
        Array.flatMap(Record.values(document.paths ?? {}), (item) =>
          Array.map(OpenApiHttpMethod.literals, (method) => item[method]?.operationId),
        ),
        Predicate.isString,
      );

      assert.deepStrictEqual(
        Array.sort(operationIds, Order.String),
        Array.sort(example.operations, Order.String),
      );

      assert.strictEqual(document.openapi, "3.1.0");

      const artifact = yield* fs
        .readFileString(fileURLToPath(new URL(`generated/${example.name}.openapi.json`, root)))
        .pipe(Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))));

      assert.deepStrictEqual(artifact, result);
    }).pipe(Effect.provide(layer)),
);

it.effect("Core removes unrelated components and retains Hotels authentication", () =>
  Effect.gen(function* () {
    const document = yield* bundleDocument(new URL("generated/core.openapi.json", root));
    assert.strictEqual(document.security, undefined);
    assert.strictEqual(document.components?.securitySchemes?.partnerServiceToken, undefined);
    expect(document.components?.securitySchemes).toHaveProperty("hotelsServiceToken");
    expect(document.components?.schemas).not.toHaveProperty("ReservationIdentityToken");
  }).pipe(Effect.provide(layer)),
);

it.effect("Nuitee search preserves the mapped room identifier correction", () =>
  Effect.gen(function* () {
    const document = yield* bundleDocument(new URL("generated/nuitee/search.openapi.json", root));

    expect(document.paths?.["/hotels/rates"]?.post).toMatchObject({
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: {
                properties: {
                  data: {
                    items: {
                      properties: {
                        roomTypes: {
                          items: {
                            properties: {
                              rates: {
                                items: { properties: { mappedRoomId: { type: "integer" } } },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  }).pipe(Effect.provide(layer)),
);

it.effect("Nuitee booking preserves decimal retail amounts and payment method types", () =>
  Effect.gen(function* () {
    const document = yield* bundleDocument(new URL("generated/nuitee/booking.openapi.json", root));

    expect(document.paths?.["/rates/book"]?.post).toMatchObject({
      requestBody: {
        content: {
          "application/json": {
            schema: {
              properties: {
                payment: {
                  anyOf: [
                    expect.objectContaining({
                      properties: expect.objectContaining({
                        method: expect.objectContaining({ type: "string" }),
                      }),
                    }),
                    expect.objectContaining({
                      properties: expect.objectContaining({
                        method: expect.objectContaining({ type: "string" }),
                      }),
                    }),
                    expect.objectContaining({
                      properties: expect.objectContaining({
                        method: expect.objectContaining({ type: "string" }),
                      }),
                    }),
                  ],
                },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: {
                properties: {
                  data: {
                    properties: {
                      bookedRooms: {
                        items: {
                          properties: {
                            rate: {
                              properties: {
                                retailRate: {
                                  properties: {
                                    total: { properties: { amount: { type: "number" } } },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  }).pipe(Effect.provide(layer)),
);
