---
"@shipworthy/openapi-cli": minor
"@shipworthy/openapi-zod": minor
"@shipworthy/openapi-standard-schema": minor
"@shipworthy/openapi-tanstack-query": minor
---

Add `--validation-middleware` to `openapi generate`. The `zod` and `standard-schema` plugins then also export openapi-fetch `onRequestValidation` and `onResponseValidation` middleware, used as `client.use({ onRequest: onRequestValidation, onResponse: onResponseValidation })`. They validate JSON request and response bodies against the OpenAPI document, by status code and media type, and throw `OpenApiValidationError` when a body does not match. Other plugins ignore the flag. With `--camel-case`, the middleware checks the API's field names. Bodies that only reference a component reuse that component's export. The library option is `validationMiddleware: true`.

The standard-schema generator now rewrites `not: { anyOf: [{ required: ["key"] }, …] }` into forbidden keys instead of failing. With `camelCase`, it drops object-valued `default`, `example`, and `examples` annotations, which kept the API's field names and made the generated module fail to type-check.

`createApiClient` from `@shipworthy/openapi-tanstack-query` no longer takes `authToken`, and its options, including `baseUrl`, are optional. The `AuthToken` and `AuthTokenProvider` types are removed. Set the `Authorization` header in an `onRequest` middleware instead:

```ts
client.use({
  async onRequest({ request }) {
    const token = await getAccessToken();
    if (token) request.headers.set("Authorization", `Bearer ${token}`);
  },
});
```
