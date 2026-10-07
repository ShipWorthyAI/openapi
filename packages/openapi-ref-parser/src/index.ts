import {
  InvalidPointerError,
  JSONParserError,
  JSONParserErrorGroup,
  MissingPointerError,
  ParserError,
  ResolverError,
  TimeoutError,
  UnmatchedParserError,
  UnmatchedResolverError,
  isHandledError,
} from "./errors.js";
import type {
  DereferenceHooks,
  FileInfo,
  HttpResolverOptions,
  Options,
  ParserPlugin,
  ResolverPlugin,
} from "./plugins.js";
import { bundleEffect, run, runDetailed, runEffect, type RunResult } from "./run.js";

export type {
  DereferenceHooks,
  FileInfo,
  HttpResolverOptions,
  Options,
  ParserPlugin,
  ResolverPlugin,
  RunResult,
};
export {
  InvalidPointerError,
  JSONParserError,
  JSONParserErrorGroup,
  MissingPointerError,
  ParserError,
  ResolverError,
  TimeoutError,
  UnmatchedParserError,
  UnmatchedResolverError,
  isHandledError,
};

export class Refs {
  constructor(readonly documents = new Map<string, unknown>()) {}

  paths(): string[] {
    return [...this.documents.keys()];
  }

  get(url: string): unknown {
    return this.documents.get(url);
  }
}

export class $RefParser {
  schema: unknown = null;
  $refs = new Refs();

  parse(...args: unknown[]): Promise<unknown> {
    return this.finish("parse", args);
  }

  resolve(...args: unknown[]): Promise<unknown> {
    return this.finish("resolve", args);
  }

  bundle(...args: unknown[]): Promise<unknown> {
    return this.finish("bundle", args);
  }

  dereference(...args: unknown[]): Promise<unknown> {
    return this.finish("dereference", args);
  }

  static parse(...args: unknown[]): Promise<unknown> {
    return run("parse", args);
  }

  static resolve(...args: unknown[]): Promise<unknown> {
    return run("resolve", args);
  }

  static bundle(...args: unknown[]): Promise<unknown> {
    return run("bundle", args);
  }

  static dereference(...args: unknown[]): Promise<unknown> {
    return run("dereference", args);
  }

  private async finish(
    mode: "parse" | "resolve" | "bundle" | "dereference",
    args: unknown[],
  ): Promise<unknown> {
    const result = await runDetailed(mode, args);
    this.schema = result.schema;
    this.$refs = new Refs(result.documents);
    return result.schema;
  }
}

export const parse = $RefParser.parse;
export const resolve = $RefParser.resolve;
export const bundle = $RefParser.bundle;
export { bundleEffect, runEffect };
export const dereference = $RefParser.dereference;

export default $RefParser;
