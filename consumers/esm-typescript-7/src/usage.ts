import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import {
  createPetsApiClient,
  createPetsApiQueryUtils,
  type PetsApiComponents,
} from "./generated/pets/client";

type Pet = PetsApiComponents["schemas"]["Pet"];

const api = createPetsApiQueryUtils(
  createPetsApiClient({ baseUrl: "https://api.test", authToken: () => "token" }),
);

export function usePets(ids: [string, ...string[]]) {
  const availability = useQuery(
    api.getAvailability.queryOptions({
      input: { query: { ids } },
      select: (response) => response.data,
    }),
  );

  const pets = useInfiniteQuery(
    api.listPets.infiniteOptions({
      initialPageParam: undefined as string | undefined,
      input: (cursor) => ({ query: { cursor } }),
      getNextPageParam: (page) => page.next_cursor ?? undefined,
      select: (data) => data.pages.flatMap((page) => page.data),
    }),
  );

  const create = useMutation(api.createPet.mutationOptions());
  const available: Pet[] | undefined = availability.data;
  const listed: Pet[] | undefined = pets.data;

  return { available, listed, create: () => create.mutate({ body: { name: "Rex" } }) };
}
