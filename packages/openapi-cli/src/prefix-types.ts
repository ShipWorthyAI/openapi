import { astToString, COMMENT_HEADER } from "@shipworthy/openapi-typescript";
import ts from "@shipworthy/openapi-typescript/compiler";

export function pascalCase(value: string): string {
  return value.replace(/(?:^|[-_])([a-zA-Z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

/** Rename generated top-level declarations and the references that point at them. */
export function prefixTypes(nodes: readonly ts.Node[], prefix: string): string {
  const names = new Map<string, string>();
  for (const node of nodes) {
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      names.set(node.name.text, `${prefix}Api${pascalCase(node.name.text.replace(/^\$/, ""))}`);
    }
  }

  const result = ts.transform(
    [...nodes],
    [
      () => {
        const visit: ts.Visitor = (node) => {
          const name =
            ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)
              ? node.name
              : ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)
                ? node.typeName
                : undefined;
          const replacement = name && names.get(name.text);
          return ts.visitEachChild(node, (child) =>
            child === name && replacement ? ts.factory.createIdentifier(replacement) : visit(child),
          );
        };
        return (node) => ts.visitNode(node, visit) as ts.Node;
      },
    ],
  );
  try {
    return COMMENT_HEADER + astToString(result.transformed);
  } finally {
    result.dispose();
  }
}
