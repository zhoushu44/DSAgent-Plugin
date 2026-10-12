"use strict";
const node_sqlite = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");
const port = process.parentPort;
if (!port) {
  throw new Error("guest-history-utility must run as a utilityProcess");
}
let db = null;
function open(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  db = new node_sqlite.DatabaseSync(databasePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS urls (
      url TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      favicon TEXT,
      last_visited INTEGER NOT NULL,
      visit_count INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS urls_recent_idx ON urls(last_visited DESC);
  `);
}
function requireDb() {
  if (!db) throw new Error("history database is not open");
  return db;
}
function mapRow(row) {
  return {
    id: row.url,
    title: row.title,
    url: row.url,
    favicon: row.favicon ?? "",
    visitedAt: Number(row.last_visited)
  };
}
function record(payload) {
  const url = payload.url?.trim();
  if (!url || url === "about:blank") return false;
  const visitedAt = payload.visitedAt ?? Date.now();
  const title = payload.title?.trim() || url;
  const favicon = payload.favicon ?? "";
  const database = requireDb();
  const existing = database.prepare("SELECT url FROM urls WHERE url = ?").get(url);
  if (existing) {
    database.prepare(
      `UPDATE urls SET title = ?, favicon = CASE WHEN ? = '' THEN favicon ELSE ? END,
         last_visited = ?, visit_count = visit_count + 1 WHERE url = ?`
    ).run(title, favicon, favicon, visitedAt, url);
  } else {
    database.prepare(
      "INSERT INTO urls (url, title, favicon, last_visited, visit_count) VALUES (?, ?, ?, ?, 1)"
    ).run(url, title, favicon, visitedAt);
  }
  database.prepare(`
    DELETE FROM urls WHERE url IN (
      SELECT url FROM urls ORDER BY last_visited DESC LIMIT -1 OFFSET 2000
    )
  `).run();
  return true;
}
function recent(limit = 100) {
  const n = Math.max(1, Math.min(500, Math.trunc(limit)));
  return requireDb().prepare("SELECT url, title, favicon, last_visited FROM urls ORDER BY last_visited DESC LIMIT ?").all(n).map(mapRow);
}
function query(payload) {
  const text = payload.text?.trim().toLowerCase();
  if (!text) return recent(payload.limit);
  const pattern = `%${text.replace(/[\\%_]/g, "\\$&")}%`;
  const n = Math.max(1, Math.min(500, Math.trunc(payload.limit ?? 100)));
  return requireDb().prepare(
    `SELECT url, title, favicon, last_visited FROM urls
         WHERE LOWER(url) LIKE ? ESCAPE '\\' OR LOWER(title) LIKE ? ESCAPE '\\'
         ORDER BY last_visited DESC LIMIT ?`
  ).all(pattern, pattern, n).map(mapRow);
}
function clear() {
  requireDb().exec("DELETE FROM urls");
  return true;
}
function clearBefore(before) {
  if (!Number.isFinite(before) || before <= 0) return clear();
  requireDb().prepare("DELETE FROM urls WHERE last_visited >= ?").run(Math.trunc(before));
  return true;
}
function remove(urls) {
  const database = requireDb();
  const stmt = database.prepare("DELETE FROM urls WHERE url = ?");
  let count = 0;
  for (const url of urls) {
    const href = url.trim();
    if (!href) continue;
    const result = stmt.run(href);
    count += Number(result.changes ?? 0);
  }
  return count;
}
function handle(type, payload) {
  switch (type) {
    case "open":
      open(String(payload?.databasePath ?? ""));
      return { ok: true };
    case "record":
      return record(payload);
    case "recent":
      return recent(payload?.limit);
    case "query":
      return query(payload ?? {});
    case "clear":
      return clear();
    case "clearBefore":
      return clearBefore(Number(payload?.before ?? 0));
    case "remove":
      return remove(payload?.urls ?? []);
    default:
      throw new Error(`unknown history command: ${type}`);
  }
}
port.on("message", (event) => {
  const message = event.data;
  if (!message?.id || !message.type) return;
  try {
    const result = handle(message.type, message.payload);
    port.postMessage({
      id: message.id,
      generation: message.generation,
      ok: true,
      result
    });
  } catch (error) {
    port.postMessage({
      id: message.id,
      generation: message.generation,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
//# sourceMappingURL=guest-history-utility.cjs.map
