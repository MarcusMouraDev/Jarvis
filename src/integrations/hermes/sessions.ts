import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { hermesHome } from "./profile";

export interface HermesSessionRow {
  id: string;
  title: string;
  updatedAt: string;
}

export function listHermesSessions(limit = 24): HermesSessionRow[] {
  const dbPath = join(hermesHome(), "state.db");
  if (!existsSync(dbPath)) return [];
  const database = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    database.pragma("query_only = ON");
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const names = new Set(tables.map((row) => row.name));
    const table = names.has("sessions")
      ? "sessions"
      : [...names].find((name) => /^[A-Za-z][A-Za-z0-9_]*$/.test(name) && name.includes("session"));
    if (!table || !/^[A-Za-z][A-Za-z0-9_]*$/.test(table)) return [];
    const columns = database
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string }>;
    const colNames = new Set(columns.map((column) => column.name));
    const idCol = ["id", "session_id", "key"].find((name) => colNames.has(name)) ?? "rowid";
    const titleCol = ["title", "name", "label"].find((name) => colNames.has(name));
    const updatedCol = ["updated_at", "updatedAt", "mtime", "created_at"].find((name) =>
      colNames.has(name),
    );
    const titleExpr = titleCol ?? `'session'`;
    const updatedExpr = updatedCol ?? "''";
    const sql = `SELECT ${idCol} AS id, ${titleExpr} AS title, ${updatedExpr} AS updatedAt FROM ${table} ORDER BY ${updatedCol ?? idCol} DESC LIMIT ?`;
    return database.prepare(sql).all(limit) as HermesSessionRow[];
  } catch {
    return [];
  } finally {
    database.close();
  }
}
