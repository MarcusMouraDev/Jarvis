export function assertNever(value: never): never {
  throw new Error(`unexpected_variant:${String(value)}`);
}
