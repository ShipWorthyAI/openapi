import type { Context, ESTree, Scope, Variable } from "@oxlint/plugins";
import { Array, Option } from "effect";

function variableInScope(scope: Scope | null, name: string): Variable | undefined {
  if (scope === null) return undefined;
  return scope.set.get(name) ?? variableInScope(scope.upper, name);
}

function effectImport(context: Context, node: ESTree.Node): string | undefined {
  if (node.type === "Identifier") {
    const variable = variableInScope(context.sourceCode.getScope(node), node.name);
    const definition = variable?.defs[0];

    if (definition?.type !== "ImportBinding" || definition.parent?.type !== "ImportDeclaration")
      return undefined;

    const source = definition.parent.source.value;
    const specifier = definition.node;

    if (source === "effect") {
      if (specifier.type === "ImportNamespaceSpecifier") return "effect";
      if (
        specifier.type === "ImportSpecifier" &&
        specifier.imported.type === "Identifier" &&
        specifier.imported.name === "Effect"
      )
        return "Effect";
    }

    if (source === "effect/Effect") {
      if (
        specifier.type === "ImportNamespaceSpecifier" ||
        specifier.type === "ImportDefaultSpecifier"
      )
        return "Effect";
      if (specifier.type === "ImportSpecifier" && specifier.imported.type === "Identifier")
        return specifier.imported.name;
    }

    return undefined;
  }

  if (node.type === "MemberExpression") {
    const name =
      !node.computed && node.property.type === "Identifier"
        ? node.property.name
        : node.property.type === "Literal" && typeof node.property.value === "string"
          ? node.property.value
          : undefined;

    const receiver = effectImport(context, node.object);

    if (receiver === "effect" && name === "Effect") return "Effect";
    if (receiver === "Effect") return name;
  }

  return undefined;
}

function isEffectGenerator(context: Context, node: ESTree.Node): boolean {
  if (node.type !== "FunctionExpression" || !node.generator) return false;
  const parent = node.parent;
  if (parent.type !== "CallExpression" || !parent.arguments.includes(node)) return false;
  const callee = parent.callee;

  if (callee.type === "CallExpression") {
    const name = effectImport(context, callee.callee);
    return name === "fn" || name === "fnUntraced";
  }

  const name = effectImport(context, callee);
  return name === "gen" || name === "fn" || name === "fnUntraced";
}

const plugin = {
  meta: { name: "shipworthy" },
  rules: {
    "prefer-effect-for-each": {
      meta: {
        type: "suggestion",
        schema: [],
        messages: {
          preferForEach:
            "Use Effect.forEach for effectful iteration; collect its results or use { discard: true }.",
        },
      },
      create(context: Context) {
        const reported = new WeakSet<ESTree.ForOfStatement>();

        return {
          YieldExpression(node: ESTree.YieldExpression) {
            if (!node.delegate) return;

            const ancestors = Array.unfold<ESTree.Node | null, ESTree.Node>(
              node.parent,
              (parent) => (parent === null ? Option.none() : Option.some([parent, parent.parent])),
            );

            const functionIndex = Array.findFirstIndex(
              ancestors,
              (ancestor) =>
                ancestor.type === "FunctionExpression" ||
                ancestor.type === "FunctionDeclaration" ||
                ancestor.type === "ArrowFunctionExpression",
            ).pipe(Option.getOrElse(() => -1));

            const enclosingFunction = ancestors[functionIndex];
            if (!enclosingFunction || !isEffectGenerator(context, enclosingFunction)) return;

            Array.forEach(Array.take(ancestors, functionIndex), (ancestor, index) => {
              if (ancestor.type !== "ForOfStatement" || reported.has(ancestor)) return;
              // Obtaining the iterable runs once; only the binding and body repeat per item.
              if ((index === 0 ? node : ancestors[index - 1]) === ancestor.right) return;
              reported.add(ancestor);
              context.report({ node: ancestor, messageId: "preferForEach" });
            });
          },
        };
      },
    },
  },
} satisfies import("@oxlint/plugins").Plugin;

export default plugin;
