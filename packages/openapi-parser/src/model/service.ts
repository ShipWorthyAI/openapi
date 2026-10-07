import { Predicate } from "effect";
import { extensionsOf, text } from "./read.js";
import { externalDocsOf } from "./transformers/servers.js";
import type { ParsedContact, ParsedInfo, ParsedLicense, ParsedTag } from "./types.js";

function contactOf(value: unknown): ParsedContact | undefined {
  if (!Predicate.isObject(value)) return undefined;
  const name = text(value.name);
  const url = text(value.url);
  const email = text(value.email);

  return {
    ...(name !== undefined ? { name } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(email !== undefined ? { email } : {}),
    extensions: extensionsOf(value),
  };
}

function licenseOf(value: unknown): ParsedLicense | undefined {
  if (!Predicate.isObject(value)) return undefined;
  const name = text(value.name);
  if (name === undefined) return undefined;
  const url = text(value.url);
  const identifier = text(value.identifier);

  return {
    name,
    ...(url !== undefined ? { url } : {}),
    ...(identifier !== undefined ? { identifier } : {}),
    extensions: extensionsOf(value),
  };
}

export function infoOf(value: unknown): ParsedInfo {
  const info = Predicate.isObject(value) ? value : {};
  const summary = text(info.summary);
  const description = text(info.description);
  const termsOfService = text(info.termsOfService);
  const contact = contactOf(info.contact);
  const license = licenseOf(info.license);

  return {
    title: text(info.title) ?? "",
    version: text(info.version) ?? "",
    ...(summary !== undefined ? { summary } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(termsOfService !== undefined ? { termsOfService } : {}),
    ...(contact ? { contact } : {}),
    ...(license ? { license } : {}),
    extensions: extensionsOf(info),
  };
}

export function tagsOf(value: unknown): readonly ParsedTag[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!Predicate.isObject(entry)) return [];
    const name = text(entry.name);
    if (name === undefined) return [];
    const description = text(entry.description);
    const externalDocs = externalDocsOf(entry.externalDocs);

    return [
      {
        name,
        ...(description !== undefined ? { description } : {}),
        ...(externalDocs ? { externalDocs } : {}),
        extensions: extensionsOf(entry),
      },
    ];
  });
}
