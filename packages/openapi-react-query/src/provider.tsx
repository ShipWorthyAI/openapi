import { createContext, useContext, type PropsWithChildren } from "react";
import { isServer, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import createClient, { type Client } from "@shipworthy/openapi-fetch";

const ApiClientContext = createContext<Client<{}> | null>(null);

export function useApiClient<Paths extends {} = {}>(): Client<Paths> {
  const client = useContext(ApiClientContext);
  if (!client) throw new Error("useApiClient must be used within ApiClientProvider");
  return client as Client<Paths>;
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 60 * 1000 } },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (isServer) return makeQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

export function ApiClientProvider({
  children,
  baseUrl,
  queryClient = getQueryClient(),
}: PropsWithChildren<{
  baseUrl: string;
  queryClient?: QueryClient;
}>) {
  const client = createClient<{}>({ baseUrl });

  return (
    <ApiClientContext.Provider value={client}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ApiClientContext.Provider>
  );
}
