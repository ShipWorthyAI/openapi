import type { OpenAPI3 } from "@shipworthy/openapi-typescript";

export const schema = {
  openapi: "3.0.3",
  info: {
    title: "Fixture",
    version: "1",
  },
  paths: {
    "/items/{id}": {
      parameters: [
        {
          $ref: "#/components/parameters/Id",
        },
      ],
      get: {
        operationId: "getItem",
        parameters: [
          {
            name: "tags",
            in: "query",
            style: "form",
            explode: false,
            schema: {
              type: "array",
              items: {
                type: "string",
              },
            },
          },
          {
            name: "filter",
            in: "query",
            style: "deepObject",
            explode: true,
            schema: {
              type: "object",
              properties: {
                country: {
                  type: "string",
                },
              },
            },
          },
        ],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Item",
                },
              },
            },
          },
          "404": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["message"],
                  properties: {
                    message: {
                      type: "string",
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: "updateItem",
        parameters: [
          {
            name: "revision",
            in: "query",
            schema: {
              type: "integer",
            },
          },
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            schema: {
              type: "string",
            },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                allOf: [
                  {
                    $ref: "#/components/schemas/Item",
                  },
                  {
                    type: "object",
                    properties: {
                      note: {
                        type: "string",
                      },
                    },
                  },
                ],
              },
            },
          },
        },
        responses: {
          "204": {
            description: "Updated",
          },
        },
      },
    },
    "/items": {
      get: {
        operationId: "listItems",
        parameters: [
          {
            name: "cursor",
            in: "query",
            schema: {
              type: "integer",
            },
          },
        ],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    next: {
                      type: "integer",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    parameters: {
      Id: {
        name: "id",
        in: "path",
        required: true,
        schema: {
          type: "string",
        },
      },
    },
    schemas: {
      Item: {
        type: "object",
        required: ["name"],
        properties: {
          name: {
            type: "string",
          },
        },
      },
    },
  },
} as unknown as OpenAPI3;

export type ItemOperation = {
  parameters: {
    path: { id: string };
    query?: { tags?: string[]; filter?: { country?: string } };
    header?: never;
  };
  requestBody?: never;
  responses: {
    200: { content: { "application/json": { name: string } } };
    404: { content: { "application/json": { message: string } } };
  };
};
export type UpdateOperation = {
  parameters: {
    path: { id: string };
    query?: { revision?: number };
    header: { "Idempotency-Key": string };
  };
  requestBody: {
    content: { "application/json": { name: string; note?: string } };
  };
  responses: { 204: { content?: never } };
};
export type ListOperation = {
  parameters: { query?: { cursor?: number } };
  responses: { 200: { content: { "application/json": { next?: number } } } };
};
