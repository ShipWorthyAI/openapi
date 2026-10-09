# @shipworthy/typescript-config

Shared `tsconfig` presets for the `@shipworthy/*` OpenAPI tooling packages.

The package has no runtime code. It ships two JSON files that you reference from your own `tsconfig.json` with `extends`:

| Preset                                       | Use it for                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `@shipworthy/typescript-config/base.json`    | Strict ES2022 code with no DOM types and no ambient `@types/*` packages. You add environment types yourself. |
| `@shipworthy/typescript-config/library.json` | Everything in `base.json`, plus DOM type libraries, Node.js types, and `jsx: "preserve"`.                    |

Use this package when you want a project to type-check with the same settings as the `@shipworthy/*` packages: strict mode, bundler-style module resolution, and type-checking only (`noEmit`).

## Installation

Install it as a dev dependency. Install `typescript` too; the package declares no dependencies or peers and supplies no runtime code or Node.js engine requirement.

```sh
npm install -D @shipworthy/typescript-config typescript
pnpm add -D @shipworthy/typescript-config typescript
yarn add -D @shipworthy/typescript-config typescript
bun add -d @shipworthy/typescript-config typescript
```

If you use `library.json`, also install Node.js types, because the preset sets `"types": ["node"]`:

```sh
npm install --save-dev @types/node
```

### TypeScript version

The presets target **TypeScript `^7.0.2`**, the version used across this monorepo. `@types/node` there is `^24.10.3`.

The presets use `libReplacement` and `noUncheckedSideEffectImports`. Older TypeScript releases don't recognize these options and will report errors for them.

## Usage

Reference a preset with `extends` in your `tsconfig.json`. Paths such as `include` and `exclude` are not inherited from the presets, so set them in your own file.

### Extend `library.json`

This is the most common setup in this repository (used by `@shipworthy/openapi-cli`, `@shipworthy/openapi-zod`, `@shipworthy/openapi-tanstack-query`, and the example SDKs):

```json
{
  "extends": "@shipworthy/typescript-config/library.json",
  "include": ["src", "test"],
  "exclude": ["node_modules"]
}
```

### Extend `base.json`

With no overrides, `base.json` provides only the ES2022 standard library and no ambient types:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "@shipworthy/typescript-config/base.json",
  "include": ["src", "test"],
  "exclude": ["node_modules"]
}
```

### Extend `base.json` and add environment types

Several packages here (`@shipworthy/openapi-generator`, `@shipworthy/openapi-transformer`, `@shipworthy/openapi-validator`) start from `base.json` and add the libraries they need:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "@shipworthy/typescript-config/base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM"],
    "types": ["node"]
  },
  "include": ["src", "test"],
  "exclude": ["node_modules"]
}
```

`lib` and `types` are arrays, so values in your file **replace** the preset's values. They are not merged. List every entry you need.

### Emitting output

Both presets set `noEmit: true`, so `tsc` only type-checks. To have `tsc` write JavaScript or declaration files, override that in a separate config, for example:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  },
  "include": ["src"]
}
```

This example emits modules for direct use in Node.js. Add `"type": "module"` to your package's `package.json` for ESM output, and use `.js` extensions in relative source imports. If a bundler consumes the output instead, keep the preset's `module` and `moduleResolution` values.

## Presets

### `base.json`

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "isolatedModules": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "noUncheckedIndexedAccess": true,
    "noUncheckedSideEffectImports": true,
    "libReplacement": false,
    "noEmit": true,
    "types": []
  }
}
```

What these options mean for your code:

**Language target and libraries**

- `target: "ES2022"` and `lib: ["ES2022"]`: ES2022 syntax and built-ins are available. DOM types (`window`, `fetch`'s `Request`/`Response`, and so on) are **not** included.
- `types: []`: no `@types/*` packages are loaded automatically. Node.js globals (`process`, `Buffer`), test-runner globals, and similar types are unavailable unless you list them in `types` or import them.
- `libReplacement: false`: TypeScript does not look for replacement `@typescript/lib-*` packages for the built-in libraries.

**Modules and resolution**

- `module: "ESNext"` with `moduleResolution: "bundler"`: ES module syntax, resolved the way bundlers and Bun resolve it. `package.json` `exports` are honored, and relative imports don't need file extensions.
- `moduleDetection: "force"`: every non-declaration file is treated as a module, even without `import`/`export`, so top-level names don't leak into a global scope.
- `isolatedModules: true`: every file must be transpilable on its own (by esbuild, Bun, SWC, and similar tools). For example, re-exporting a type requires `export type`.
- `esModuleInterop: true`: default imports from CommonJS modules work (`import x from "cjs-package"`).
- `noUncheckedSideEffectImports: true`: side-effect imports (`import "./setup"`) must resolve, or they are reported as errors.

**Strictness**

- `strict: true`: turns on the full strict family (`strictNullChecks`, `noImplicitAny`, and so on).
- `noUncheckedIndexedAccess: true`: indexing an array or a record returns `T | undefined`. Check for `undefined` before using the value.
- `forceConsistentCasingInFileNames: true`: an import must match the file name's casing exactly.

**Emit and performance**

- `noEmit: true`: the preset type-checks only. Builds are expected to come from a bundler or a separate emit config (see [Emitting output](#emitting-output)).
- `skipLibCheck: true`: `.d.ts` files, including those in `node_modules`, are not type-checked.

### `library.json`

```json
{
  "extends": "./base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node"]
  }
}
```

`library.json` inherits every option from `base.json` and changes three:

| Option  | `base.json`  | `library.json`                      | Effect                                                                                                    |
| ------- | ------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `lib`   | `["ES2022"]` | `["ES2022", "DOM", "DOM.Iterable"]` | Adds browser and Web API types (`fetch`, `Request`, `URL`, `Headers`) and iteration over DOM collections. |
| `types` | `[]`         | `["node"]`                          | Loads Node.js globals from `@types/node`. **`@types/node` must be installed.**                            |
| `jsx`   | not set      | `"preserve"`                        | Allows `.tsx` files and leaves JSX unchanged. The JSX transform is left to your bundler or runtime.       |

Choose `library.json` for code that runs in both browsers and Node.js/Bun, or code that uses Web APIs or JSX. Choose `base.json` when you want to control environment types yourself.

## Key facts for AI agents

- Package name: `@shipworthy/typescript-config`. Exports exactly two files: `./base.json` and `./library.json`. There is no JavaScript entry point.
- Use the presets only through `"extends": "@shipworthy/typescript-config/<preset>.json"` in a `tsconfig.json`.
- Target TypeScript `^7.0.2`. `libReplacement` and `noUncheckedSideEffectImports` need a recent compiler.
- Both presets set `noEmit: true`. To emit, override `noEmit: false` and set `outDir`/`declaration` in a separate config.
- `moduleResolution` is `"bundler"`, with `module: "ESNext"`. Relative import extensions are optional for bundler consumers. For direct Node.js output, use a build config with `NodeNext` resolution and `.js` relative imports.
- `noUncheckedIndexedAccess` is on: `arr[i]` and `record[key]` are `T | undefined`. Narrow them before use.
- `isolatedModules` is on: use `export type` / `import type` for type-only re-exports.
- `base.json` has `types: []` and no DOM lib. Node.js globals and `fetch` types are missing unless you add them.
- `library.json` adds `DOM`, `DOM.Iterable`, `types: ["node"]`, and `jsx: "preserve"`. It requires `@types/node` to be installed.
- Overriding `lib` or `types` replaces the preset's array. It does not append to it.
- The presets don't set `include`, `exclude`, `rootDir`, or `outDir`. Set them in the extending config.

## License

MIT. See [LICENSE](./LICENSE).
