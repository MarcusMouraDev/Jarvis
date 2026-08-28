type Pragmas = {
  pragma(value: string): unknown;
};

/** Shared SQLite settings that preserve each store's existing durability. */
export function configureSqliteConnection(
  database: Pragmas,
  options: { foreignKeys?: boolean } = {},
): void {
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");
  if (options.foreignKeys) database.pragma("foreign_keys = ON");
}
