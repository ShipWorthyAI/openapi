#!/usr/bin/env bun
import { clientSource, generateSchema } from "./generator";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { astToString, COMMENT_HEADER, ts } from "@shipworthy/openapi-typescript-api";

const usage = `Usage: openapi-react-query <schema-url-or-file> -o <directory> --name <name>

Generates <directory>/<name>/types.ts and client.ts.

Example:
  openapi-react-query http://hotels.shipworthy.localhost/docs/openapi.json -o ./src/generated --name hotels`;

function pascalCase(value: string): string {
  return value.replace(/(?:^|[-_])([a-zA-Z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

function prefixTypes(nodes: ts.Node[], prefix: string): string {
  const names = new Map<string, string>();
  for (const node of nodes) {
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      names.set(node.name.text, `${prefix}Api${pascalCase(node.name.text.replace(/^\$/, ""))}`);
    }
  }

  const result = ts.transform(nodes, [
    (context) => {
      const visit: ts.Visitor = (node) => {
        // Rename declaration names and type references, never schema property keys.
        const name =
          ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)
            ? node.name
            : ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)
              ? node.typeName
              : undefined;
        const replacement = name && names.get(name.text);
        return ts.visitEachChild(
          node,
          (child) =>
            child === name && replacement ? ts.factory.createIdentifier(replacement) : visit(child),
          context,
        );
      };
      return (node) => ts.visitNode(node, visit) as ts.Node;
    },
  ]);
  try {
    return COMMENT_HEADER + astToString(result.transformed);
  } finally {
    result.dispose();
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: "string", short: "o" },
      name: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  const [input] = positionals;
  if (!input || positionals.length !== 1 || !values.output || !values.name) {
    throw new Error(usage);
  }
  if (!/^[a-zA-Z][a-zA-Z0-9]*(?:[-_][a-zA-Z0-9]+)*$/.test(values.name)) {
    throw new Error(
      "--name must start with a letter and contain only letters, numbers, and single hyphen or underscore separators.",
    );
  }

  const schema = /^(https?:|file:)/i.test(input) ? new URL(input) : pathToFileURL(resolve(input));
  const prefix = pascalCase(values.name);
  const { nodes, routes } = await generateSchema(schema);
  const types = prefixTypes(nodes, prefix);
  const output = resolve(values.output, values.name);
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, "types.ts"), types);
  await writeFile(resolve(output, "client.ts"), clientSource(prefix, values.name, routes));
  console.log(`Generated ${output}/types.ts and ${output}/client.ts`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
