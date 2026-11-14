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

Fix `--camel-case` responses that came back still snake_case when the parsed JSON body was a plain object from another JavaScript realm, such as `response.json()` under Jest with Node's global `fetch` (for example MSW `HttpResponse.json(...)` mocks). Plain objects from any realm are now converted, while `Date`, `Map` and class instances are still left untouched.
