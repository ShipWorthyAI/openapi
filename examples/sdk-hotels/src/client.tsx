import { useQuery } from "@tanstack/react-query";
import { createHotelsApiClient, createHotelsApiQueryUtils } from "./generated/hotels/client";
import {
  OpenApiValidationError,
  onRequestValidation,
  onResponseValidation,
} from "./generated/hotels/zod-schema";

/**
 * A Hotels API client that validates JSON request and response bodies against the OpenAPI
 * document. A body that does not match rejects the call with `OpenApiValidationError`.
 */
export const client = createHotelsApiClient();

client.use({
  async onRequest({ request }) {
    request.headers.set("Authorization", `Bearer 123`);
  },
});

client.use({ onRequest: onRequestValidation, onResponse: onResponseValidation });

/** TanStack Query utilities for `client`, so queries and mutations run through its middleware. */
export const hotelsApi = createHotelsApiQueryUtils(client);

/** US hotels with at least four stars, fetched through `client` and its validation middleware. */
export function Hotels() {
  const hotels = useQuery(
    hotelsApi.getHotels.queryOptions({
      input: {
        query: {
          country: "US",
          minStars: 4,
        },
      },
    }),
  );

  if (hotels.isPending) return <p>Loading hotels…</p>;

  if (hotels.isError) {
    return hotels.error instanceof OpenApiValidationError ? (
      <p>The {hotels.error.direction} body does not match the API schema.</p>
    ) : (
      <p>Could not load hotels.</p>
    );
  }

  return (
    <ul>
      {hotels.data.data.map((hotel) => (
        <li key={hotel.id}>{hotel.name}</li>
      ))}
    </ul>
  );
}
