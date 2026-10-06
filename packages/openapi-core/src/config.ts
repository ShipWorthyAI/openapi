import { existsSync } from "node:fs";
import path from "node:path";
import { $RefParser } from "@shipworthy/json-schema-ref-parser";

export const CONFIG_FILE_NAMES = [
  "shipworthy.yaml",
  "shipworthy.yml",
  ".shipworthy.yaml",
  ".shipworthy.yml",
];

export interface Config {
  configFile?: string;
  apis?: Record<string, { root?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export type ShipWorthyConfig = Config;

export function findConfig(dir?: string): string | undefined {
  const existingConfigFiles = CONFIG_FILE_NAMES.map((name) =>
    dir ? path.resolve(dir, name) : name,
  ).filter((file) => existsSync(file));
  if (existingConfigFiles.length > 1) {
    throw new Error(`
      Multiple configuration files are not allowed.
      Found the following files: ${existingConfigFiles.join(", ")}.
      Please use 'shipworthy.yaml' instead.
    `);
  }
  return existingConfigFiles[0];
}

export async function loadConfig(options: { configPath?: string } = {}): Promise<Config> {
  const configPath = options.configPath ?? findConfig();
  if (!configPath) return {};

  try {
    const parsed = await $RefParser.dereference<Config>(configPath);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Config must be an object.");
    }
    validateApis(parsed.apis);
    return { ...parsed, configFile: configPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Error parsing config file at '${configPath}': ${message}`);
  }
}

export async function createConfig(
  config: Config = {},
  options?: { extends?: string[]; configPath?: string },
): Promise<Config> {
  validateApis(config.apis);
  return { ...config, ...(options?.configPath ? { configFile: options.configPath } : {}) };
}

function validateApis(apis: Config["apis"]) {
  if (apis === undefined) return;
  if (!apis || typeof apis !== "object" || Array.isArray(apis)) {
    throw new Error("Config apis must be an object.");
  }
  for (const [name, api] of Object.entries(apis)) {
    if (!api || typeof api !== "object" || typeof api.root !== "string") {
      throw new Error(`API ${name} is missing a root document.`);
    }
  }
}
