import createClient from "@shipworthy/openapi-fetch";

export function createApiClient<Paths extends {}>(baseUrl: string, authToken?: string) {
  return createClient<Paths>({
    baseUrl,
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;
