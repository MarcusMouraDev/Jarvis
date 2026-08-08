import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const DB_DIR = path.join(process.cwd(), ".jarvis");
const DB_PATH = path.join(DB_DIR, "memory.db");

let db: Database.Database | null = null;
let overridePath: string | null = null;

export function setMemoryDbPathForTests(dbPath: string | null): void {
  if (db) {
    db.close();
    db = null;
  }
  overridePath = dbPath;
}

function initSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS memory (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      confidence REAL NOT NULL DEFAULT 0.5,
      consent INTEGER NOT NULL DEFAULT 0,
      expiresAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_link (
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      relation TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0.5,
      provenance TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (source, target, relation)
    );

    CREATE INDEX IF NOT EXISTS idx_memory_consent_expires
      ON memory (consent, expiresAt);
  `);
}

export function getMemoryDb(): Database.Database {
  if (!db) {
    const target = overridePath ?? DB_PATH;
    if (target !== ":memory:") {
      fs.mkdirSync(path.dirname(target), { recursive: true });
    }
    db = new Database(target);
    db.pragma("journal_mode = WAL");
    initSchema(db);
  }
  return db;
}

export function closeMemoryDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
