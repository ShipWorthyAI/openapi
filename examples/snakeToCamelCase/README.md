# snake_case API with camelCase app fields

This example generates TanStack Query clients from a small [Hotels document](./openapi.yaml) and
a [sanitized reservations document](./openapi.json). The APIs declare snake_case fields.
The app-facing `types.ts` and clients use camelCase fields in application code.
The reservations document omits provider mapping extensions and uses example URLs and problem types.

From the repository root, regenerate the clients and validators and run the example test:

```sh
bun run --cwd examples/snakeToCamelCase generate
bun run --cwd examples/snakeToCamelCase test
```

The `generate` script runs `openapi generate tanstack-query -i ./openapi.yaml -o src/generated/hotels --camel-case`,
writing `src/generated/hotels/{types.ts,client.ts}`. For reservations it runs one
`openapi generate zod tanstack-query -i ./openapi.json -o src/generated/reservations --camel-case --wire-types`
command, writing `src/generated/reservations/{client.ts,types.ts,wire-types.ts,zod-schema.ts}`.

## Reservation service output

The reservations document defines nine operations. Its generated types include
`reservationId` for the `/v1/reservations/{reservation_id}` path parameter, `slotId` and
`projectLocationId` for the `createHold` request, and `expiresAt` on the hold response. The
generated client converts these names when it sends requests and reads JSON responses.

```ts
import { createReservationsApiClient, createReservationsApiQueryUtils } from "./src";

const client = createReservationsApiClient({ baseUrl: "https://api.example.com" });
const reservationsApi = createReservationsApiQueryUtils(client);

const reservation = reservationsApi.getReservation.queryOptions({
  input: { path: { reservationId: "resv_123" } },
});

const hold = reservationsApi.createHold.mutationOptions();
const createdHold = await hold.mutationFn({
  header: { "Idempotency-Key": "example-attempt-1" },
  body: {
    slotId: "slot_123",
    projectLocationId: "123",
    seating: { id: "seat_123", name: "Main room", environment: null, attributes: [] },
    timestamp: "2026-11-13T19:00:00Z",
    guests: 2,
  },
});
console.log(createdHold.projectLocationId, createdHold.expiresAt);
```

The request to `createHold` sends `slot_id` and `project_location_id`. A returned
`ReservationHold` has `projectLocationId` and `expiresAt` in app code. The example test exercises
both directions against a mock `fetch` function.

The generated `wire-types.ts` types the API shape seen by custom `fetch` wrappers and raw response
fixtures. For example:

```ts
import type { components as WireComponents } from "./src/generated/reservations/wire-types";

type WireHold = WireComponents["schemas"]["ReservationHold"];
// WireHold has project_location_id and expires_at; the client returns camelCase instead.
```

Field names inside JSON Pointer string values keep API spelling, such as `/payment_source_id`.

The generated Zod validators in `zod-schema.ts` accept the camelCase shapes used in app code and
are typed with the camelCase `types.ts` in the same directory. The example test parses the
`createHold` request body before passing it to the client and parses the `ReservationHold` the
client returns. A snake_case API payload does not pass these validators:

```ts
import { createHoldRequestBody, ReservationHold } from "./src/generated/reservations/zod-schema";

const body = createHoldRequestBody.parse({
  slotId: "slot_123",
  projectLocationId: "123",
  seating: { id: "seat_123", name: "Main room", environment: null, attributes: [] },
  timestamp: "2026-11-13T19:00:00Z",
  guests: 2,
});
const createdHold = ReservationHold.parse(
  await hold.mutationFn({ header: { "Idempotency-Key": "example-attempt-1" }, body }),
);
console.log(createdHold.projectLocationId, createdHold.expiresAt);
```

Use `wire-types.ts` to type raw API payloads.

## Small Hotels example

Use the generated helpers inside an existing React Native `QueryClientProvider`:

```tsx
import { useMutation, useQuery } from "@tanstack/react-query";
import { Text } from "react-native";
import { createHotelsApiClient, createHotelsApiQueryUtils } from "./src";

const client = createHotelsApiClient({ baseUrl: "https://api.example.com" });
const hotelsApi = createHotelsApiQueryUtils(client);

function HotelScreen({ hotelId }: { hotelId: string }) {
  const hotel = useQuery(
    hotelsApi.getHotel.queryOptions({
      input: { path: { hotelId }, query: { includeReviews: true } },
    }),
  );
  const createHotel = useMutation(hotelsApi.createHotel.mutationOptions());

  // createHotel.mutate({ body: { displayName: "North", address: {
  //   streetName: "Main Street", postalCode: "60601" } } });
  return <Text>{hotel.data?.displayName}</Text>;
}
```

`getHotel` sends `/hotels/{hotel_id}` with `include_reviews=true`, and `createHotel` sends JSON
with `display_name` and `street_name`. Responses arrive with camelCase fields.
