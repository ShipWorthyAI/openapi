export function pascalCase(value: string): string {
  return value.replace(/(?:^|[-_])([a-zA-Z0-9])/g, (_, letter: string) => letter.toUpperCase());
}
