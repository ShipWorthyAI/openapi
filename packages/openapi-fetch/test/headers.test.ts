import { describe, expect, it } from "vitest";

import createClient, { mergeHeaders } from "../src/index.js";
import { createRecordingFetch, type paths } from "./fixtures.js";

describe("mergeHeaders", () => {
  it("accepts plain objects, Headers, and tuple arrays", () => {
    const merged = mergeHeaders(
      { "X-A": "1", "X-Drop": "x" },
      new Headers({ "X-B": "2" }),
      [
        ["X-C", "3"],
        ["X-C", "4"],
      ],
      { "X-Drop": null, "X-Skip": undefined },
    );

    expect(Object.fromEntries(merged.entries())).toEqual({
      "x-a": "1",
      "x-b": "2",
      "x-c": "3, 4",
    });
  });

  it("lets a later tuple array override an earlier value", () => {
    const merged = mergeHeaders({ "X-A": "1" }, [["x-a", "2"]]);

    expect(merged.get("X-A")).toBe("2");
  });

  it("still appends array values in plain objects", () => {
    const merged = mergeHeaders({ "X-A": ["1", 2] });

    expect(merged.get("X-A")).toBe("1, 2");
  });
});

describe("client headers", () => {
  it("accepts tuple arrays at client and request level", async () => {
    const { fetch, requests } = createRecordingFetch();

    const client = createClient<paths>({
      baseUrl: "https://api.test",
      fetch,
      headers: [
        ["X-Client", "web"],
        ["Accept-Language", "en"],
      ],
    });

    await client.GET("/session", { headers: [["X-Client", "cli"]] });

    const headers = requests[0]?.headers;
    expect(headers?.get("X-Client")).toBe("cli");
    expect(headers?.get("Accept-Language")).toBe("en");
  });

  it("accepts a Headers instance at client level and removes with null", async () => {
    const { fetch, requests } = createRecordingFetch();

    const client = createClient<paths>({
      baseUrl: "https://api.test",
      fetch,
      headers: new Headers({ "X-Client": "web", "Accept-Language": "en" }),
    });

    await client.GET("/session", { headers: { "Accept-Language": null } });

    const headers = requests[0]?.headers;
    expect(headers?.get("X-Client")).toBe("web");
    expect(headers?.has("Accept-Language")).toBe(false);
  });
});
