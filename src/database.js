const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');

let db;

async function init() {
  const SQL = await initSqlJs();
  const dbDir = path.dirname(config.DB_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  if (fs.existsSync(config.DB_PATH)) {
    const buffer = fs.readFileSync(config.DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      domain TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      is_working INTEGER NOT NULL DEFAULT 1,
      login_works INTEGER DEFAULT NULL,
      signup_works INTEGER DEFAULT NULL,
      create_content_works INTEGER DEFAULT NULL,
      requires_approval INTEGER DEFAULT NULL,
      credentials TEXT DEFAULT NULL,
      notes TEXT DEFAULT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  save();
}

function save() {
  const data = db.export();
  fs.writeFileSync(config.DB_PATH, Buffer.from(data));
}

function run(sql, params = []) {
  db.run(sql, params);
  save();
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function addSite(data) {
  run(
    `INSERT INTO sites (url, domain, category, is_working, login_works, signup_works, create_content_works, requires_approval, credentials, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.url, data.domain, data.category, data.is_working, data.login_works, data.signup_works, data.create_content_works, data.requires_approval, data.credentials, data.notes]
  );
  const row = get('SELECT last_insert_rowid() as id');
  return { lastInsertRowid: row.id };
}

function getSiteById(id) {
  return get('SELECT * FROM sites WHERE id = ?', [id]);
}

function getSiteByDomain(domain) {
  return get('SELECT * FROM sites WHERE domain = ?', [domain]);
}

function searchSites(query) {
  const pattern = `%${query}%`;
  return all('SELECT * FROM sites WHERE domain LIKE ? OR url LIKE ?', [pattern, pattern]);
}

function listSites(page = 1, perPage = 10) {
  const offset = (page - 1) * perPage;
  const sites = all('SELECT id, url, domain, category, is_working FROM sites ORDER BY id DESC LIMIT ? OFFSET ?', [perPage, offset]);
  const row = get('SELECT COUNT(*) as count FROM sites');
  const count = row ? row.count : 0;
  return { sites, total: count, page, totalPages: Math.ceil(count / perPage) };
}

function updateSite(id, data) {
  const existing = getSiteById(id);
  if (!existing) return null;
  const merged = { ...existing, ...data, id };
  run(
    `UPDATE sites SET url = ?, domain = ?, category = ?, is_working = ?, login_works = ?, signup_works = ?, create_content_works = ?, requires_approval = ?, credentials = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [merged.url, merged.domain, merged.category, merged.is_working, merged.login_works, merged.signup_works, merged.create_content_works, merged.requires_approval, merged.credentials, merged.notes, id]
  );
  return getSiteById(id);
}

function updateSiteField(id, field, value) {
  const allowedFields = [
    'url', 'domain', 'category', 'is_working', 'login_works', 'signup_works',
    'create_content_works', 'requires_approval', 'credentials', 'notes',
  ];
  if (!allowedFields.includes(field)) return null;
  run(`UPDATE sites SET ${field} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [value, id]);
  return getSiteById(id);
}

function deleteSite(id) {
  run('DELETE FROM sites WHERE id = ?', [id]);
}

function getAllSites() {
  return all('SELECT * FROM sites ORDER BY id');
}

function getSitesByDays(days) {
  return all("SELECT * FROM sites WHERE created_at >= datetime('now', ? || ' days') OR updated_at >= datetime('now', ? || ' days') ORDER BY id", [`-${days}`, `-${days}`]);
}

function getSitesByIdRange(from, to) {
  return all('SELECT * FROM sites WHERE id >= ? AND id <= ? ORDER BY id', [from, to]);
}

function getSitesByCategory(category) {
  return all('SELECT * FROM sites WHERE category = ? ORDER BY id', [category]);
}

module.exports = {
  init,
  addSite,
  getSiteById,
  getSiteByDomain,
  searchSites,
  listSites,
  updateSite,
  updateSiteField,
  deleteSite,
  getAllSites,
  getSitesByDays,
  getSitesByIdRange,
  getSitesByCategory,
};
