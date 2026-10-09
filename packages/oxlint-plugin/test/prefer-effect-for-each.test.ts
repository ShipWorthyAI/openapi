import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import plugin from "../src/index.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const message = { messageId: "preferForEach" };

tester.run("prefer-effect-for-each", plugin.rules["prefer-effect-for-each"], {
  valid: [
    `import { Effect } from "effect";
     Effect.gen(function* () { return yield* Effect.forEach(items, visit); });`,
    `import { Effect } from "effect";
     Effect.gen(function* () { for (const item of items) { inspect(item); } });`,
    `import { Effect } from "effect";
     Effect.gen(function* () { for (const item of yield* loadItems()) { inspect(item); } });`,
    `function* values() { for (const item of items) { yield* item; } }`,
    `import { Effect } from "another-library";
     Effect.gen(function* () { for (const item of items) { yield* visit(item); } });`,
    `import { Effect } from "effect";
     function run(Effect) {
       return Effect.gen(function* () { for (const item of items) { yield* item; } });
     }`,
    `import { Effect } from "effect";
     Effect.gen(function* () {
       for (const item of items) {
         function* values() { yield* item; }
       }
     });`,
    `import { Effect } from "effect";
     for (const item of items) { Effect.gen(function* () { yield* visit(item); }); }`,
    `import { Effect } from "effect";
     Effect.gen(function* () {
       for (const item of items) { Effect.gen(function* () { yield* visit(item); }); }
     });`,
    `import { gen } from "effect/Effect";
     function run(gen) { return gen(function* () { for (const x of items) { yield* x; } }); }`,
    `import * as Effect from "effect/Effect";
     function run() {
       const Effect = other;
       return Effect.fn(function* () { for (const x of items) { yield* x; } });
     }`,
  ],
  invalid: [
    {
      name: "Effect.gen traversal",
      code: `import { Effect } from "effect";
             Effect.gen(function* () { for (const item of items) { yield* visit(item); } });`,
      errors: [message],
      output: null,
    },
    {
      name: "named Effect.fn traversal",
      code: `import { Effect } from "effect";
             const run = Effect.fn("run")(function* () {
               for (const item of items) { yield* visit(item); }
             });`,
      errors: [message],
      output: null,
    },
    {
      name: "untraced traversal",
      code: `import { Effect } from "effect";
             Effect.fnUntraced(function* () { for (const item of items) { yield* visit(item); } });`,
      errors: [message],
    },
    {
      name: "direct Effect.fn and multiple yields report one loop",
      code: `import { Effect } from "effect";
             Effect.fn(function* () {
               for (const item of items) { yield* visit(item); yield* visitAgain(item); }
             });`,
      errors: [message],
    },
    {
      name: "import alias",
      code: `import { Effect as Fx } from "effect";
             Fx.gen(function* () { for (const item of items) { yield* visit(item); } });`,
      errors: [message],
    },
    {
      name: "Effect subpath namespace",
      code: `import * as Fx from "effect/Effect";
             Fx.gen(function* () { for (const item of items) { yield* visit(item); } });`,
      errors: [message],
    },
    {
      name: "direct subpath function import",
      code: `import { gen as compose } from "effect/Effect";
             compose(function* () { for (const item of items) { yield* visit(item); } });`,
      errors: [message],
    },
    {
      name: "curried subpath function import",
      code: `import { fn as traced } from "effect/Effect";
             traced("run")(function* () { for (const item of items) { yield* visit(item); } });`,
      errors: [message],
    },
    {
      name: "package namespace",
      code: `import * as Fx from "effect";
             Fx.Effect.gen(function* () { for (const item of items) { yield* visit(item); } });`,
      errors: [message],
    },
    {
      name: "computed property",
      code: `import { Effect } from "effect";
             Effect["gen"](function* () { for (const item of items) { yield* visit(item); } });`,
      errors: [message],
    },
    {
      name: "nested effectful loops",
      code: `import { Effect } from "effect";
             Effect.gen(function* () {
               for (const group of groups) { for (const item of group) { yield* visit(item); } }
             });`,
      errors: [message, message],
    },
    {
      name: "obtaining an inner iterable is an effect of the outer loop only",
      code: `import { Effect } from "effect";
             Effect.gen(function* () {
               for (const group of groups) {
                 for (const item of yield* loadItems(group)) { inspect(item); }
               }
             });`,
      errors: [message],
    },
    {
      name: "report inner Effect loop without attributing it to the outer generator",
      code: `import { Effect } from "effect";
             function* values() {
               for (const group of groups) {
                 yield Effect.gen(function* () {
                   for (const item of group) { yield* visit(item); }
                 });
               }
             }`,
      errors: [message],
    },
    {
      name: "branching loop has no unsafe autofix",
      code: `import { Effect } from "effect";
             Effect.gen(function* () {
               for (const item of items) {
                 if (item.skip) continue;
                 if (item.stop) break;
                 return yield* visit(item);
               }
             });`,
      errors: [message],
      output: null,
    },
  ],
});
