export { default } from "./client.js";
export { wrapAsPathBasedClient, createPathBasedClient } from "./path-client.js";
export { mergeHeaders } from "./headers.js";
export {
  serializePrimitiveParam,
  serializeObjectParam,
  serializeArrayParam,
} from "./serializers/param.js";
export { createQuerySerializer } from "./serializers/query.js";
export { defaultPathSerializer } from "./serializers/path.js";
export { defaultBodySerializer } from "./serializers/body.js";
export { createFinalURL, removeTrailingSlash } from "./serializers/url.js";
export type {
  BodySerializer,
  Client,
  ClientForPath,
  ClientMethod,
  ClientOptions,
  ClientPathsWithMethod,
  ClientRequestMethod,
  DefaultParamsOption,
  FetchOptions,
  FetchResponse,
  HeadersOptions,
  MaybeOptionalInit,
  MergedOptions,
  MethodResponse,
  Middleware,
  MiddlewareCallbackParams,
  MiddlewareRequestParams,
  ParamsOption,
  ParseAs,
  ParseAsResponse,
  PathBasedClient,
  PathSerializer,
  QuerySerializer,
  QuerySerializerOptions,
  RequestBodyOption,
  RequestOptions,
} from "./types.js";
