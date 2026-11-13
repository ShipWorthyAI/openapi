import { expect, it } from "vitest";
import type { components as WireComponents } from "../src/generated/reservations/wire-types.ts";
import {
  createHoldRequestBody,
  ReservationHold,
} from "../src/generated/reservations/zod-schema.ts";
import {
  createHotelsApiClient,
  createHotelsApiQueryUtils,
  createReservationsApiClient,
  createReservationsApiQueryUtils,
} from "../src/index.ts";

it("uses camelCase in TanStack Query while sending snake_case to the API", async () => {
  const requests: Request[] = [];

  const client = createHotelsApiClient({
    baseUrl: "https://api.example.test",
    fetch: async (request) => {
      requests.push(request);

      return Response.json(
        {
          hotel_id: "h_1",
          display_name: "North",
          address: { street_name: "Main Street", postal_code: "60601" },
        },
        { status: request.method === "POST" ? 201 : 200 },
      );
    },
  });

  const hotelsApi = createHotelsApiQueryUtils(client);

  const query = hotelsApi.getHotel.queryOptions({
    input: { path: { hotelId: "h_1" }, query: { includeReviews: true } },
  });

  const hotel = await query.queryFn({ signal: new AbortController().signal } as Parameters<
    typeof query.queryFn
  >[0]);

  expect(hotel).toEqual({
    hotelId: "h_1",
    displayName: "North",
    address: { streetName: "Main Street", postalCode: "60601" },
  });

  expect(requests[0]?.url).toBe("https://api.example.test/hotels/h_1?include_reviews=true");

  const created = await hotelsApi.createHotel.mutationOptions().mutationFn({
    body: {
      displayName: "North",
      address: { streetName: "Main Street", postalCode: "60601" },
    },
  });

  expect(created.hotelId).toBe("h_1");

  expect(await requests[1]?.json()).toEqual({
    display_name: "North",
    address: { street_name: "Main Street", postal_code: "60601" },
  });
});

it("uses camelCase with the sanitized reservations OpenAPI document", async () => {
  const requests: Request[] = [];

  const seating = {
    id: "seat_123",
    name: "Main room",
    environment: null,
    attributes: [],
  } satisfies WireComponents["schemas"]["ReservationSeating"];

  const timestamp = "2026-11-13T19:00:00Z";

  const client = createReservationsApiClient({
    baseUrl: "https://reservations.example.test",
    fetch: async (request) => {
      requests.push(request);

      if (request.method === "GET") {
        return Response.json({
          id: "resv_123",
          project_location_id: "123",
          provider: "opentable",
          status: "confirmed",
          state: "CONFIRMED",
          timestamp,
          guests: 2,
          seating,
          slot_id: "slot_123",
          external_url: "https://provider.example.test/resv_123",
          notes: "",
          payment: null,
          policies: { booking: [], cancellation: null },
          cash_back_percent: 30,
        });
      }

      return Response.json(
        {
          id: "hold_123",
          project_location_id: "123",
          provider: "opentable",
          status: "active",
          expires_at: "2026-11-13T19:05:00Z",
          slot: {
            id: "slot_123",
            project_location_id: "123",
            provider: "opentable",
            guests: 2,
            timestamp,
            seating,
            payment: null,
          },
          policies: { booking: [], cancellation: null },
        } satisfies WireComponents["schemas"]["ReservationHold"],
        { status: 201 },
      );
    },
  });

  const reservationsApi = createReservationsApiQueryUtils(client);

  const query = reservationsApi.getReservation.queryOptions({
    input: { path: { reservationId: "resv_123" } },
  });

  const reservation = await query.queryFn({ signal: new AbortController().signal } as Parameters<
    typeof query.queryFn
  >[0]);

  expect(requests[0]?.url).toBe("https://reservations.example.test/v1/reservations/resv_123");
  expect(reservation.projectLocationId).toBe("123");
  expect(reservation.slotId).toBe("slot_123");
  expect(reservation.externalUrl).toBe("https://provider.example.test/resv_123");
  expect(reservation.cashBackPercent).toBe(30);

  const holdBody = createHoldRequestBody.parse({
    slotId: "slot_123",
    projectLocationId: "123",
    seating,
    timestamp,
    guests: 2,
  });

  const hold = await reservationsApi.createHold.mutationOptions().mutationFn({
    header: { "Idempotency-Key": "example-attempt-1" },
    body: holdBody,
  });

  expect(requests[1]?.url).toBe("https://reservations.example.test/v1/holds");
  expect(requests[1]?.headers.get("Idempotency-Key")).toBe("example-attempt-1");

  const wireBody = await requests[1]?.json();

  expect(wireBody).toEqual({
    slot_id: "slot_123",
    project_location_id: "123",
    seating,
    timestamp,
    guests: 2,
  });

  expect(createHoldRequestBody.safeParse(wireBody).success).toBe(false);

  expect(ReservationHold.parse(hold)).toEqual(hold);
  expect(hold.projectLocationId).toBe("123");
  expect(hold.expiresAt).toBe("2026-11-13T19:05:00Z");
  expect(hold.slot.projectLocationId).toBe("123");
});
