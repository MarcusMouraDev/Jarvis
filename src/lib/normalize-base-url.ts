/** Removes trailing separators before composing an HTTP endpoint path. */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}
