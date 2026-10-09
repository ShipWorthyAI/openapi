import { describe, expect, it } from "vitest";

import createClient from "../src/index.ts";
import { createRecordingFetch, type paths } from "./fixtures.ts";

describe("cookie params", () => {
  it("serializes params.cookie into a Cookie header", async () => {
    const { fetch, requests } = createRecordingFetch();
    const client = createClient<paths>({ baseUrl: "https://api.test", fetch });

    await client.GET("/session", { params: { cookie: { session: "abc 123", count: 2 } } });

    expect(requests[0]?.headers.get("Cookie")).toBe("session=abc%20123; count=2");
  });

  it("uses form/explode for arrays and objects", async () => {
    const { fetch, requests } = createRecordingFetch();
    const client = createClient<paths>({ baseUrl: "https://api.test", fetch });

    await client.GET("/session", {
      params: { cookie: { tags: ["a", "b"], prefs: { theme: "dark", lang: "en" } } },
    });

    expect(requests[0]?.headers.get("Cookie")).toBe("tags=a; tags=b; theme=dark; lang=en");
  });

  it("skips undefined and null values and omits the header when empty", async () => {
    const { fetch, requests } = createRecordingFetch();
    const client = createClient<paths>({ baseUrl: "https://api.test", fetch });

    await client.GET("/session", { params: { cookie: { session: null, tags: undefined } } });

    expect(requests[0]?.headers.has("Cookie")).toBe(false);
  });

  it("merges with a Cookie header from client and request headers", async () => {
    const { fetch, requests } = createRecordingFetch();

    const client = createClient<paths>({
      baseUrl: "https://api.test",
      fetch,
      headers: { Cookie: "client=1" },
    });

    await client.GET("/session", { params: { cookie: { session: "s" } } });

    await client.GET("/session", {
      headers: [["Cookie", "request=2"]],
      params: { cookie: { session: "s" } },
    });

    expect(requests[0]?.headers.get("Cookie")).toBe("client=1; session=s");
    expect(requests[1]?.headers.get("Cookie")).toBe("request=2; session=s");
  });
});
