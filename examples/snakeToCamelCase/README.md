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

The `generate` script runs `openapi generate tanstack-query` with `--camel-case` and writes
`src/generated/hotels/{types.ts,client.ts}`. For reservations it also passes `--wire-types`,
writing `src/generated/reservations/{types.ts,wire-types.ts,client.ts}`. It then runs
`openapi generate zod` for reservations, writing
`src/generated/reservations/validators/{types.ts,zod-schema.ts}`. The separate directory keeps
Zod's wire-shaped `types.ts` from replacing the client's camelCase `types.ts`.

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

The generated Zod validators accept API-shaped payloads. The example test parses the outgoing
`createHold` request and the raw `ReservationHold` response before the client converts the
response to camelCase:

```ts
import {
  createHoldRequestBody,
  ReservationHold,
} from "./src/generated/reservations/validators/zod-schema";

const wireRequest = createHoldRequestBody.parse(await request.json());
const wireHold = ReservationHold.parse(await response.json());
console.log(wireRequest.project_location_id, wireHold.expires_at);
```

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
