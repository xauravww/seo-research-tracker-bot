const Database = require('better-sqlite3');
const config = require('./config');

const db = new Database(config.DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
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

const stmts = {
  insert: db.prepare(`
    INSERT INTO sites (url, domain, category, is_working, login_works, signup_works, create_content_works, requires_approval, credentials, notes)
    VALUES (@url, @domain, @category, @is_working, @login_works, @signup_works, @create_content_works, @requires_approval, @credentials, @notes)
  `),
  getById: db.prepare('SELECT * FROM sites WHERE id = ?'),
  getByDomain: db.prepare('SELECT * FROM sites WHERE domain = ?'),
  searchByDomain: db.prepare("SELECT * FROM sites WHERE domain LIKE ? OR url LIKE ?"),
  listAll: db.prepare('SELECT id, url, domain, category, is_working FROM sites ORDER BY id DESC LIMIT ? OFFSET ?'),
  countAll: db.prepare('SELECT COUNT(*) as count FROM sites'),
  update: db.prepare(`
    UPDATE sites SET url = @url, domain = @domain, category = @category, is_working = @is_working,
    login_works = @login_works, signup_works = @signup_works, create_content_works = @create_content_works,
    requires_approval = @requires_approval, credentials = @credentials, notes = @notes,
    updated_at = CURRENT_TIMESTAMP WHERE id = @id
  `),
  updateField: (field) => db.prepare(`UPDATE sites SET ${field} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`),
  deleteById: db.prepare('DELETE FROM sites WHERE id = ?'),
};

function addSite(data) {
  return stmts.insert.run(data);
}

function getSiteById(id) {
  return stmts.getById.get(id);
}

function getSiteByDomain(domain) {
  return stmts.getByDomain.get(domain);
}

function searchSites(query) {
  const pattern = `%${query}%`;
  return stmts.searchByDomain.all(pattern, pattern);
}

function listSites(page = 1, perPage = 10) {
  const offset = (page - 1) * perPage;
  const sites = stmts.listAll.all(perPage, offset);
  const { count } = stmts.countAll.get();
  return { sites, total: count, page, totalPages: Math.ceil(count / perPage) };
}

function updateSite(id, data) {
  const existing = getSiteById(id);
  if (!existing) return null;
  const merged = { ...existing, ...data, id };
  stmts.update.run(merged);
  return getSiteById(id);
}

function updateSiteField(id, field, value) {
  const allowedFields = [
    'url', 'domain', 'category', 'is_working', 'login_works', 'signup_works',
    'create_content_works', 'requires_approval', 'credentials', 'notes',
  ];
  if (!allowedFields.includes(field)) return null;
  stmts.updateField(field).run(value, id);
  return getSiteById(id);
}

function deleteSite(id) {
  return stmts.deleteById.run(id);
}

function getAllSites() {
  return db.prepare('SELECT * FROM sites ORDER BY id').all();
}

function getSitesByDays(days) {
  return db.prepare("SELECT * FROM sites WHERE created_at >= datetime('now', ? || ' days') OR updated_at >= datetime('now', ? || ' days') ORDER BY id")
    .all(`-${days}`, `-${days}`);
}

function getSitesByIdRange(from, to) {
  return db.prepare('SELECT * FROM sites WHERE id >= ? AND id <= ? ORDER BY id').all(from, to);
}

function getSitesByCategory(category) {
  return db.prepare('SELECT * FROM sites WHERE category = ? ORDER BY id').all(category);
}

module.exports = {
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
