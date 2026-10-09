import { effectNative, strict } from "@effect/tsgo/oxlint-presets";
import { Record } from "effect";
import { defineConfig } from "oxlint";

const effectNativeErrors = Record.map(effectNative.rules ?? {}, () => "error" as const);

const multilineStatements = [
  "multiline-block-like",
  "multiline-const",
  "multiline-expression",
  "multiline-let",
  "multiline-return",
  "multiline-type",
  "multiline-using",
  "multiline-var",
];

export default defineConfig({
  extends: [strict],
  options: {
    typeAware: true,
    typeCheck: true,
    reportUnusedDisableDirectives: "error",
  },
  plugins: ["eslint", "typescript", "unicorn", "oxc", "import", "react", "effecttsgo"],
  ignorePatterns: ["**/dist/**", "**/.turbo/**", "examples/*/src/generated/**"],
  categories: {
    correctness: "error",
  },
  jsPlugins: [
    "@stylistic/eslint-plugin",
    { name: "shipworthy", specifier: "@shipworthy/oxlint-plugin" },
  ],
  overrides: [
    {
      files: ["packages/*/src/**/*.ts"],
      // These runtime clients deliberately expose native Promise APIs without Effect.
      excludeFiles: [
        "packages/openapi-fetch/src/**",
        "packages/openapi-react-query/src/**",
        "packages/openapi-tanstack-query/src/**",
      ],
      rules: effectNativeErrors,
    },
    {
      files: ["packages/openapi-tanstack-query/src/generator.ts"],
      rules: effectNativeErrors,
    },
  ],
  rules: {
    "@stylistic/padding-line-between-statements": [
      "error",
      {
        blankLine: "always",
        next: "*",
        prev: multilineStatements,
      },
      {
        blankLine: "always",
        next: multilineStatements,
        prev: "*",
      },
      { blankLine: "any", next: "*", prev: ["export", "import"] },
      { blankLine: "any", next: ["export", "import"], prev: "*" },
      {
        blankLine: "any",
        next: ["function", "function-overload"],
        prev: "function-overload",
      },
      {
        blankLine: "any",
        next: ["case", "default"],
        prev: ["case", "default"],
      },
      {
        blankLine: "always",
        next: ["case", "default"],
        prev: "multiline-block-like",
      },
    ],

    "effecttsgo/unstable-api-usage": "off",
    "effecttsgo/missed-pipeable-opportunity": "error",
    "effecttsgo/nested-effect-gen-yield": "error",
    "effecttsgo/effect-do-notation": "error",
    "shipworthy/prefer-effect-for-each": "error",
  },
});
