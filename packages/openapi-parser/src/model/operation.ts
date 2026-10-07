import { Predicate } from "effect";
import type { OpenAPIDocument } from "../document.js";
import { resolveLocal } from "./pointer.js";
import { extensionsOf, text } from "./read.js";
import { groupParameters } from "./transformers/parameters.js";
import { requestBody } from "./transformers/request.js";
import { operationResponses } from "./transformers/responses.js";
import { externalDocsOf } from "./transformers/servers.js";
import { securityRequirements } from "./transformers/securities.js";
import {
  httpMethods,
  type HttpMethodName,
  type ParsedOperation,
  type ParsedSecurityRequirement,
} from "./types.js";

export function operationsOf(
  document: OpenAPIDocument,
  documentSecurity: readonly ParsedSecurityRequirement[],
): readonly ParsedOperation[] {
  const paths = Predicate.isObject(document.paths) ? document.paths : {};
  const operations: ParsedOperation[] = [];

  for (const [path, item] of Object.entries(paths)) {
    if (path.startsWith("x-")) continue;
    const pathItem = resolveLocal(document, item);
    if (!Predicate.isObject(pathItem)) continue;

    for (const method of httpMethods) {
      const raw = pathItem[method];
      if (raw === undefined) continue;
      const operation = resolveLocal(document, raw);
      if (!Predicate.isObject(operation)) continue;
      const operationId = text(operation.operationId);
      const summary = text(operation.summary);
      const description = text(operation.description);
      const externalDocs = externalDocsOf(operation.externalDocs);
      const body = requestBody(document, operation.requestBody);
      const parsedResponses = operationResponses(document, operation.responses);
      const declared = Object.hasOwn(operation, "security");
      const security = declared ? securityRequirements(operation.security) : documentSecurity;

      operations.push({
        ...(operationId !== undefined ? { operationId } : {}),
        method: method.toUpperCase() as HttpMethodName,
        path,
        tags: Array.isArray(operation.tags)
          ? operation.tags.filter((tag): tag is string => typeof tag === "string")
          : [],
        metadata: {
          deprecated: operation.deprecated === true,
          ...(summary !== undefined ? { summary } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(externalDocs ? { externalDocs } : {}),
        },
        parameters: groupParameters(document, pathItem.parameters, operation.parameters),
        ...(body ? { requestBody: body } : {}),
        responses: parsedResponses.responses,
        ...(parsedResponses.defaultResponse
          ? { defaultResponse: parsedResponses.defaultResponse }
          : {}),
        security,
        securityDeclaration: !declared
          ? documentSecurity.length > 0
            ? "inherited"
            : "none"
          : security.length > 0
            ? "declared"
            : "none",
        extensions: extensionsOf(operation),
      });
    }
  }

  return operations;
}
