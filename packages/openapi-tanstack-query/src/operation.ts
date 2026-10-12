import type {
  ErrorResponse,
  MediaType,
  RequestBodyOption,
  ResponseObjectMap,
  SuccessResponse,
} from "@shipworthy/openapi-fetch";

/** Preserve OpenAPI's parameter groups and add its typed request body. */
export type OperationInput<Op> = (Op extends { parameters: infer Parameters } ? Parameters : {}) &
  RequestBodyOption<Op>;
type Responses<Op> = Extract<ResponseObjectMap<Op>, Record<string | number, unknown>>;

type NormalizeData<T> = [T] extends [never]
  ? null
  : Exclude<T, undefined> | (undefined extends T ? null : never);

// Requests parse JSON, so prefer it when a response also offers another media type, such as a stream.
type JsonResponses<Op> = {
  [Status in keyof Responses<Op>]: Responses<Op>[Status] extends {
    content: { "application/json": infer Data };
  }
    ? { content: { "application/json": Data } }
    : Responses<Op>[Status];
};

export type OperationData<Op> = NormalizeData<SuccessResponse<JsonResponses<Op>, MediaType>>;
export type OperationError<Op> = ErrorResponse<Responses<Op>, MediaType> | Error;
