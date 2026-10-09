# @shipworthy/example-sdk-reservations

Example modeled on inKind's `@inkind/sdk-reservations`: Reservations types and operation-based TanStack Query utilities.

```sh
bun run generate
```

`openapi.json` is a snapshot of `http://reservations.inkind.localhost/docs/openapi.json`.

```ts
import {
  createReservationsApiClient,
  createReservationsApiQueryUtils,
} from "@shipworthy/example-sdk-reservations";

const client = createReservationsApiClient({ baseUrl: "http://reservations.inkind.localhost" });
const reservationsApiQueryUtils = createReservationsApiQueryUtils(client);
```
