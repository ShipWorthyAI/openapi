# @shipworthy/openapi-react-query

Typesafe API client for the Shipworthy API.

## Usage

### Generate types and a client from an OpenAPI spec

```bash
npx openapi-react-query http://api.shipworthy.localhost/docs/demo.openapi.json -o ./src/generated --name demo
```

The CLI also accepts a local JSON or YAML file. It writes
`src/generated/demo/types.ts` with `DemoApiPaths`, `DemoApiComponents`,
`DemoApiOperations`, and other prefixed top-level types, plus
`src/generated/demo/client.ts` with the typed client, provider export, and hooks.
Import these helpers from `./generated/demo/client`. Hyphenated or underscored
names become PascalCase exports (for example, `demo-search` becomes `DemoSearch`).
Running the command again overwrites both generated files.

### Use within React

Wrap app or component in the `ApiClientProvider`.

```tsx
import { ApiClientProvider } from "@shipworthy/openapi-react-query";

<ApiClientProvider baseUrl={process.env.SHIPWORTHY_API_URL}>
  <App />
</ApiClientProvider>;
```

```tsx
import { useApiClientQuery } from "@shipworthy/openapi-react-query";
import type { paths } from "./generated";

function YourComponent() {
  const response = useApiClientQuery<paths>("/api/v6/app/locations", "get", {
    params: {
      query: {
        cc: "US",
      },
    },
  });

  response.data?.brands;
  response.data?.locations;
  response.data?.groups;
  response.data?.tags;
}
```

### Use within JS/TS

```ts
import { createApiClient } from "@shipworthy/openapi-react-query";
import type { paths } from "./generated";

const shipworthyApi = createApiClient<paths>(process.env.SHIPWORTHY_API_URL);
const response = await shipworthyApi.GET("/api/v6/app/locations", {
  params: {
    query: {
      cc: "US",
    },
  },
});
```
