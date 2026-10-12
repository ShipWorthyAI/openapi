import type { InfiniteData } from "@tanstack/react-query";
import { describe, expect, expectTypeOf, it } from "vitest";
import { createApiClient, createTanstackQueryUtils } from "../src/index.ts";

interface Slot {
  id: string;
}

interface Page {
  data: Array<Slot>;
  next_cursor?: string;
}

type Operations = {
  getAvailability: {
    parameters: { query: { ids: [string, ...Array<string>] } };
    requestBody?: never;
    responses: {
      200: {
        headers: { [name: string]: unknown };
        content: { "application/json": { data: Array<Slot> }; "text/event-stream": string };
      };
    };
  };
  getReservations: {
    parameters: { query?: { cursor?: string } };
    requestBody?: never;
    responses: {
      200: { headers: { [name: string]: unknown }; content: { "application/json": Page } };
    };
  };
};

type Paths = {
  "/availability": { get: Operations["getAvailability"] };
  "/reservations": { get: Operations["getReservations"] };
};

const routes = {
  getAvailability: ["GET", "/availability"],
  getReservations: ["GET", "/reservations"],
} as const;

function queryUtils(fetch: (request: Request) => Promise<Response>) {
  return createTanstackQueryUtils<Operations>(
    createApiClient<Paths>({ baseUrl: "https://api.test", fetch }),
    routes,
    { prefix: "test" },
  );
}

describe("createTanstackQueryUtils", () => {
  it("types JSON data when a response also offers a stream", async () => {
    const api = queryUtils(async () => Response.json({ data: [{ id: "slot" }] }));
    const options = api.getAvailability.queryOptions({ input: { query: { ids: ["1"] } } });

    expectTypeOf(options.queryFn).returns.resolves.toEqualTypeOf<{ data: Array<Slot> }>();

    const signal = new AbortController().signal;
    const data = await options.queryFn({ signal } as Parameters<typeof options.queryFn>[0]);
    expect(data).toEqual({ data: [{ id: "slot" }] });
  });

  it("passes infinite pages to select", () => {
    const api = queryUtils(async () => Response.json({ data: [] }));

    const options = api.getReservations.infiniteOptions({
      initialPageParam: undefined as string | undefined,
      input: (cursor) => ({ query: { cursor } }),
      getNextPageParam: (page) => page.next_cursor,
      select: (data) => data.pages.flatMap((page) => page.data),
    });

    type Select = NonNullable<typeof options.select>;
    expectTypeOf<Parameters<Select>[0]>().toEqualTypeOf<InfiniteData<Page, string | undefined>>();
    expectTypeOf<ReturnType<Select>>().toEqualTypeOf<Array<Slot>>();
  });
});
