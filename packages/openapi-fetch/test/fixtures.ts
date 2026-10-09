export interface paths {
  "/session": {
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: {
          session?: string | null;
          tags?: string[];
          prefs?: { theme?: string; lang?: string };
          count?: number;
        };
      };
      requestBody?: never;
      responses: {
        200: {
          headers: Record<string, unknown>;
          content: { "application/json": { ok: boolean } };
        };
      };
    };
  };
}

/** A fetch stub that records each `Request` and returns an empty JSON object */
export function createRecordingFetch() {
  const requests: Request[] = [];

  const fetch = async (request: Request) => {
    requests.push(request);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  };

  return { fetch, requests };
}
