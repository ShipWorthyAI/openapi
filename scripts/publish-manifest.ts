// Swaps a package's development manifest for its publish manifest while Bun packs it.
//
// In the workspace, `exports`, `bin`, and `imports` point at TypeScript source so tests and
// tools run without a build. `publishConfig` holds the compiled `dist` equivalents. Bun only
// reads `access`, `registry`, and `tag` from `publishConfig`, but it re-reads package.json after
// `prepack` and runs `postpack` afterwards, so `prepack` promotes the other `publishConfig`
// fields to the top level and `postpack` restores the development manifest.
//
// Usage (from a package directory): bun ../../scripts/publish-manifest.ts prepack|postpack
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const manifestPath = "package.json";
const backupPath = "node_modules/.package.dev.json";
const registryFields = new Set(["access", "registry", "tag", "provenance"]);

const prepack = () => {
  if (existsSync(backupPath)) {
    throw new Error(
      `${backupPath} exists. Run postpack to restore the development manifest first.`,
    );
  }

  const source = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(source);
  const publishConfig: Record<string, unknown> = manifest.publishConfig ?? {};
  const remaining: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(publishConfig)) {
    if (registryFields.has(key)) {
      remaining[key] = value;
    } else {
      manifest[key] = value;
    }
  }

  if (Object.keys(remaining).length > 0) {
    manifest.publishConfig = remaining;
  } else {
    delete manifest.publishConfig;
  }

  mkdirSync("node_modules", { recursive: true });
  writeFileSync(backupPath, source);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
};

const postpack = () => {
  if (existsSync(backupPath)) {
    renameSync(backupPath, manifestPath);
  }
};

const command = process.argv[2];

if (command === "prepack") {
  prepack();
} else if (command === "postpack") {
  postpack();
} else {
  throw new Error(`Unknown command ${String(command)}. Use prepack or postpack.`);
}
