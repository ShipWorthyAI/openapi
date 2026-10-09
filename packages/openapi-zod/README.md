# @shipworthy/openapi-zod

Generate Zod validators from an OpenAPI 3.1 document. Component schemas become named exports. Each JSON request body becomes `<operationId>RequestBody`. Shared JSON Schema stays in a module-local `definitions` object, and each validator includes only the `$defs` it references.

```sh
openapi generate zod ./openapi.yaml -o ./src/generated --name hotels
```

That writes `hotels/schema.ts`. The command also runs `openapi generate typescript` for the same schema when `hotels/types.ts` is missing or was generated from a different input. Re-running the command overwrites `schema.ts` after generation succeeds.

Generated files require `zod@4.6.5`. `fromJSONSchema` is experimental, so that version is pinned. Each export is typed from the sibling `types.ts` (`components["schemas"][Name]`, or the operation's JSON request body), so the file needs `openapi generate typescript` output next to it; the CLI writes it. Each export is wrapped in `z.compile()`, which falls back to Zod's runtime parser for schemas the fast path cannot compile.

```ts
import { Item, createBookingRequestBody } from "./generated/hotels/schema";

const hotel = Item.parse(input);
const booking = createBookingRequestBody.parse(body);
```

The validators are not called by the fetch client. Call them where a payload should be checked.

## Limits

Generation supports OpenAPI 3.1 and a single `application/json` request body per operation. Operations need unique `operationId`s, and no component schema may share a name with a `<operationId>RequestBody` export. Custom JSON Schema dialects, top-level `$defs`, and keywords Zod cannot preserve fail generation before any file is written. Response schemas and non-JSON bodies are not emitted. Business rules that exist only in descriptions need their own checks.
