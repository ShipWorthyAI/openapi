# @shipworthy/openapi-zod

Generate Zod validators from an OpenAPI 3.1 document. Component schemas become named exports. Each JSON request body becomes `<operationId>RequestBody`. Shared JSON Schema lives in `definitions.ts`, and each validator includes only the `$defs` it references.

```sh
openapi zod ./openapi.yaml -o ./src/generated --name hotels
```

That writes `hotels/types.ts`, `hotels/definitions.ts`, `hotels/schemas.ts`, and `hotels/operations.ts`. The types are generated with defaults left optional, because the validators drop `default` and do not fill it in while parsing. Re-running the command overwrites those files after generation succeeds.

Generated files require `zod@4.6.5`. `fromJSONSchema` is experimental, so that version is pinned. Each export is wrapped in `z.compile()`, which falls back to Zod's runtime parser for schemas the fast path cannot compile.

```ts
import { Item } from "./generated/hotels/schemas";
import { createBookingRequestBody } from "./generated/hotels/operations";

const hotel = Item.parse(input);
const booking = createBookingRequestBody.parse(body);
```

The validators are not called by the fetch client. Call them where a payload should be checked.

## Limits

Generation supports OpenAPI 3.1 and a single `application/json` request body per operation. Operations need unique `operationId`s. Custom JSON Schema dialects, top-level `$defs`, and keywords Zod cannot preserve fail generation before any file is written. Response schemas and non-JSON bodies are not emitted. Business rules that exist only in descriptions need their own checks.
