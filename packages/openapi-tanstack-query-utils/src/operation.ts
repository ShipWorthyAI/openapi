import type { RequestBodyOption } from "@shipworthy/openapi-fetch";
import type {
  ErrorResponse,
  MediaType,
  ResponseObjectMap,
  SuccessResponse,
} from "@shipworthy/openapi-typescript-helpers";

/** Preserve OpenAPI's parameter groups and add its typed request body. */
export type OperationInput<Op> = (Op extends { parameters: infer Parameters } ? Parameters : {}) &
  RequestBodyOption<Op>;
type Responses<Op> = Extract<ResponseObjectMap<Op>, Record<string | number, unknown>>;

type NormalizeData<T> = [T] extends [never]
  ? null
  : Exclude<T, undefined> | (undefined extends T ? null : never);
export type OperationData<Op> = NormalizeData<SuccessResponse<Responses<Op>, MediaType>>;
export type OperationError<Op> = ErrorResponse<Responses<Op>, MediaType> | Error;
