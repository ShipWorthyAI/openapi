import { createReservationsApiClient } from "./generated/reservations/client";
import { onRequestValidation, onResponseValidation } from "./generated/reservations/zod-schema";

/**
 * A Reservations API client that validates JSON request and response bodies against the
 * OpenAPI document. A body that does not match rejects the call with `OpenApiValidationError`.
 */
export const client = createReservationsApiClient();

client.use({
  async onRequest({ request }) {
    request.headers.set("Authorization", `Bearer 123`);
  },
});

client.use({ onRequest: onRequestValidation, onResponse: onResponseValidation });

client
  .GET("/v1/availability", {
    params: {
      query: {
        project_location_ids: ["the_guest_house_austin"],
      },
    },
  })
  .then(() => {})
  .catch(() => {});
