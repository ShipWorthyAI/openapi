import { recommended } from "@effect/tsgo/oxlint-presets";
import { defineConfig } from "oxlint";

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
  extends: [recommended],
  options: {
    typeAware: true,
    typeCheck: true,
  },
  plugins: ["eslint", "typescript", "unicorn", "oxc", "import", "react", "effecttsgo"],
  ignorePatterns: ["**/dist/**", "**/.turbo/**"],
  categories: {
    correctness: "error",
  },
  jsPlugins: ["@stylistic/eslint-plugin"],
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
  },
});
