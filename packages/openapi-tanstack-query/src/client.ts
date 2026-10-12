// Named import: bundled CommonJS reads a default import as the whole `exports` object.
import { createClient, type Client, type ClientOptions } from "@shipworthy/openapi-fetch";

export type AuthToken = string | undefined | null;
export type AuthTokenProvider = () => AuthToken | Promise<AuthToken>;
export interface ApiClientOptions extends Omit<ClientOptions, "baseUrl"> {
  baseUrl: string;
  authToken?: AuthToken | AuthTokenProvider;
}

export function createApiClient<Paths extends {}>({
  authToken,
  ...options
}: ApiClientOptions): Client<Paths> {
  const client = createClient<Paths>(options);

  if (authToken !== undefined) {
    client.use({
      async onRequest({ request }) {
        const token = typeof authToken === "function" ? await authToken() : authToken;

        if (request.signal?.aborted) {
          const error = new Error("Request aborted");
          error.name = "AbortError";
          throw error;
        }

        if (token) request.headers.set("Authorization", `Bearer ${token}`);
        else request.headers.delete("Authorization");
        return request;
      },
    });
  }

  return client;
}

export type ApiClient<Paths extends {} = {}> = Client<Paths>;
