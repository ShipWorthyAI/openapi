// Named import: bundled CommonJS reads a default import as the whole `exports` object.
import { createClient, type Client, type ClientOptions } from "@shipworthy/openapi-fetch";

export type ApiClientOptions = ClientOptions;

/** Creates an openapi-fetch client. Register auth and other behavior with `client.use(...)`. */
export function createApiClient<Paths extends {}>(options?: ApiClientOptions): Client<Paths> {
  return createClient<Paths>(options);
}

export type ApiClient<Paths extends {} = {}> = Client<Paths>;
