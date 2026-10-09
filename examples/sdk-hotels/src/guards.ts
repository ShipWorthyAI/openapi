import type { HotelsApiComponents, HotelsApiOperations } from "./generated/hotels/client";

type GetRatesRequest =
  HotelsApiOperations["getRates"]["requestBody"]["content"]["application/json"];

type Schemas = HotelsApiComponents["schemas"];

export const isGetRatesByHotelIds = (
  request: GetRatesRequest,
): request is Schemas["GetRatesByHotelIds"] => "hotel_ids" in request;

export const isGetRatesByGeo = (request: GetRatesRequest): request is Schemas["GetRatesByGeo"] =>
  "geo" in request;

export const isGetRatesByMarket = (
  request: GetRatesRequest,
): request is Schemas["GetRatesByMarket"] => "market" in request;

export const isGetRatesByPlaceId = (
  request: GetRatesRequest,
): request is Schemas["GetRatesByPlaceId"] => "place_id" in request;

// Selector-based searches may also include a query filter.
export const isGetRatesByQuery = (
  request: GetRatesRequest,
): request is Schemas["GetRatesByQuery"] =>
  request.query !== undefined &&
  !isGetRatesByHotelIds(request) &&
  !isGetRatesByGeo(request) &&
  !isGetRatesByMarket(request) &&
  !isGetRatesByPlaceId(request);
