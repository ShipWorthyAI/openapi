---
"@shipworthy/openapi-cli": patch
"@shipworthy/openapi-fetch": patch
"@shipworthy/openapi-generator": patch
"@shipworthy/openapi-overlay": patch
"@shipworthy/openapi-parser": patch
"@shipworthy/openapi-react-query": patch
"@shipworthy/openapi-standard-schema": patch
"@shipworthy/openapi-tanstack-query": patch
"@shipworthy/openapi-transformer": patch
"@shipworthy/openapi-typescript": patch
"@shipworthy/openapi-validator": patch
"@shipworthy/openapi-zod": patch
---

Run case mapping as the innermost fetch middleware, so `onRequestInit` and `onResult` hooks added with `client.use` or per request work with app-facing camelCase names instead of the API's. `onResult` also receives `attempt` and `retry({ headers })`: return the retried result to replace the call's `data`, `error` and `response`, for example to sign in and resend a request without reading the raw response in a custom `fetch`.
