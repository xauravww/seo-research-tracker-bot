const express = require('express');
const path = require('path');
const config = require('../config');
const db = require('../database');
const { extractDomain } = require('../utils/url');
const XLSX = require('xlsx');
const fs = require('fs');
const { boolLabel } = require('../utils/format');

function startWeb() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Simple session via cookie
  const sessions = new Set();
  function generateToken() {
    return require('crypto').randomBytes(32).toString('hex');
  }

  function authMiddleware(req, res, next) {
    const token = req.headers['x-auth-token'] || req.query.token;
    if (sessions.has(token)) return next();
    res.status(401).json({ error: 'Unauthorized' });
  }

  // --- Auth routes ---
  app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === config.ADMIN_USERNAME && password === config.ADMIN_PASSWORD) {
      const token = generateToken();
      sessions.add(token);
      res.json({ token });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  });

  app.post('/api/logout', authMiddleware, (req, res) => {
    const token = req.headers['x-auth-token'];
    sessions.delete(token);
    res.json({ ok: true });
  });

  // --- Stats ---
  app.get('/api/stats', authMiddleware, (req, res) => {
    res.json(db.getStats());
  });

  // --- CRUD routes ---
  app.get('/api/sites', authMiddleware, (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const perPage = parseInt(req.query.perPage) || 20;
    const search = req.query.search || '';
    const category = req.query.category || '';
    const status = req.query.status || '';
    const published = req.query.published || '';
    const sortBy = req.query.sortBy || 'id';
    const sortOrder = req.query.sortOrder || 'DESC';

    res.json(db.listSites(page, perPage, { search, category, status, published, sortBy, sortOrder }));
  });

  app.get('/api/sites/:id', authMiddleware, (req, res) => {
    const site = db.getSiteById(parseInt(req.params.id));
    if (!site) return res.status(404).json({ error: 'Not found' });
    res.json(site);
  });

  app.post('/api/sites', authMiddleware, (req, res) => {
    try {
      const parsed = extractDomain(req.body.url);
      if (!parsed) return res.status(400).json({ error: 'Invalid URL' });

      const existing = db.getSiteByDomain(parsed.domain);
      if (existing) return res.status(409).json({ error: 'Domain already exists', existing });

      const data = {
        url: parsed.url,
        domain: parsed.domain,
        category: req.body.category || 'Blog',
        is_working: req.body.is_working != null ? parseInt(req.body.is_working) : 1,
        login_works: req.body.login_works != null ? parseInt(req.body.login_works) : null,
        signup_works: req.body.signup_works != null ? parseInt(req.body.signup_works) : null,
        create_content_works: req.body.create_content_works != null ? parseInt(req.body.create_content_works) : null,
        requires_approval: req.body.requires_approval != null ? parseInt(req.body.requires_approval) : null,
        is_published: req.body.is_published != null ? parseInt(req.body.is_published) : null,
        credentials: req.body.credentials || null,
        notes: req.body.notes || null,
      };

      const result = db.addSite(data);
      const site = db.getSiteById(result.lastInsertRowid);
      res.json(site || { id: result.lastInsertRowid, ...data });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/sites/:id', authMiddleware, (req, res) => {
    const id = parseInt(req.params.id);
    const existing = db.getSiteById(id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const updates = {};
    const fields = ['category', 'is_working', 'login_works', 'signup_works', 'create_content_works', 'requires_approval', 'is_published', 'credentials', 'notes'];
    for (const f of fields) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }

    if (req.body.url && req.body.url !== existing.url) {
      const parsed = extractDomain(req.body.url);
      if (!parsed) return res.status(400).json({ error: 'Invalid URL' });
      updates.url = parsed.url;
      updates.domain = parsed.domain;
    }

    const site = db.updateSite(id, updates);
    res.json(site);
  });

  app.delete('/api/sites/:id', authMiddleware, (req, res) => {
    const id = parseInt(req.params.id);
    const site = db.getSiteById(id);
    if (!site) return res.status(404).json({ error: 'Not found' });
    db.deleteSite(id);
    res.json({ ok: true });
  });

  // --- Categories list ---
  app.get('/api/categories', authMiddleware, (req, res) => {
    const { CATEGORIES } = require('../handlers/addWizard');
    res.json(CATEGORIES);
  });

  // --- Bulk Upload Template ---
  app.get('/api/template/upload', authMiddleware, (req, res) => {
    const headers = ['URL', 'Category', 'Working', 'Login Works', 'Signup Works', 'Create Content', 'Requires Approval', 'Published', 'Credentials', 'Notes'];
    const example = ['https://example.com', 'Blog', 'Yes', 'Yes', 'No', 'N/A', 'N/A', 'No', 'email:test@test.com, password:abc123', 'Sample note'];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    ws['!cols'] = headers.map((h, i) => ({ wch: Math.max(h.length, (example[i] || '').length) + 4 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Upload Template');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename=bulk_upload_template.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  });

  // --- Bulk Update Template ---
  app.get('/api/template/update', authMiddleware, (req, res) => {
    const sites = db.getAllSites();
    const data = sites.map(s => ({
      ID: s.id,
      URL: s.url,
      Domain: s.domain,
      Category: s.category,
      Working: boolLabel(s.is_working),
      'Login Works': boolLabel(s.login_works),
      'Signup Works': boolLabel(s.signup_works),
      'Create Content': boolLabel(s.create_content_works),
      'Requires Approval': boolLabel(s.requires_approval),
      Published: boolLabel(s.is_published),
      Credentials: s.credentials || '',
      Notes: s.notes || '',
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ ID: '', URL: '', Domain: '', Category: '', Working: '', 'Login Works': '', 'Signup Works': '', 'Create Content': '', 'Requires Approval': '', Published: '', Credentials: '', Notes: '' }]);
    XLSX.utils.book_append_sheet(wb, ws, 'Sites');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename=bulk_update_template.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  });

  // --- Bulk Upload Preview (parse file, check duplicates) ---
  app.post('/api/bulk-preview', authMiddleware, (req, res) => {
    try {
      const { rows } = req.body; // array of row objects parsed client-side
      if (!rows || !rows.length) return res.status(400).json({ error: 'No rows found' });

      const results = rows.map((row, idx) => {
        const url = (row['URL'] || row['url'] || '').trim();
        if (!url) return { row: idx + 2, url: '', status: 'error', reason: 'Missing URL', data: row };

        const parsed = extractDomain(url);
        if (!parsed) return { row: idx + 2, url, status: 'error', reason: 'Invalid URL', data: row };

        const existing = db.getSiteByDomain(parsed.domain);
        const item = {
          row: idx + 2,
          url: parsed.url,
          domain: parsed.domain,
          status: existing ? 'duplicate' : 'new',
          reason: existing ? `Already exists (ID: ${existing.id})` : 'Ready to add',
          existingId: existing ? existing.id : null,
          data: row,
        };
        return item;
      });

      res.json({ results });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Bulk Upload Confirm (save selected rows) ---
  app.post('/api/bulk-upload', authMiddleware, (req, res) => {
    try {
      const { items } = req.body; // array of { url, data } objects
      if (!items || !items.length) return res.status(400).json({ error: 'No items to add' });

      let added = 0, skipped = 0, errors = [];
      for (const item of items) {
        try {
          const parsed = extractDomain(item.url);
          if (!parsed) { errors.push(`Invalid URL: ${item.url}`); skipped++; continue; }

          const existing = db.getSiteByDomain(parsed.domain);
          if (existing) { skipped++; continue; }

          const d = item.data;
          db.addSite({
            url: parsed.url,
            domain: parsed.domain,
            category: d.category || 'Blog',
            is_working: parseBoolField(d.is_working),
            login_works: parseBoolFieldNullable(d.login_works),
            signup_works: parseBoolFieldNullable(d.signup_works),
            create_content_works: parseBoolFieldNullable(d.create_content_works),
            requires_approval: parseBoolFieldNullable(d.requires_approval),
            is_published: parseBoolFieldNullable(d.is_published),
            credentials: d.credentials || null,
            notes: d.notes || null,
          });
          added++;
        } catch (err) {
          errors.push(`${item.url}: ${err.message}`);
          skipped++;
        }
      }

      res.json({ added, skipped, errors });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Bulk Update ---
  app.post('/api/bulk-update', authMiddleware, (req, res) => {
    try {
      const { items } = req.body;
      if (!items || !items.length) return res.status(400).json({ error: 'No items to update' });

      let updated = 0, skipped = 0, errors = [];
      for (const item of items) {
        try {
          const id = parseInt(item.id);
          if (!id) { skipped++; continue; }

          const existing = db.getSiteById(id);
          if (!existing) { errors.push(`ID ${id} not found`); skipped++; continue; }

          const d = item.data;
          const updates = {};

          if (d.category && d.category !== existing.category) updates.category = d.category;
          if (d.is_working !== undefined) { const v = parseBoolField(d.is_working); if (v !== existing.is_working) updates.is_working = v; }
          if (d.login_works !== undefined) { const v = parseBoolFieldNullable(d.login_works); if (v !== existing.login_works) updates.login_works = v; }
          if (d.signup_works !== undefined) { const v = parseBoolFieldNullable(d.signup_works); if (v !== existing.signup_works) updates.signup_works = v; }
          if (d.create_content_works !== undefined) { const v = parseBoolFieldNullable(d.create_content_works); if (v !== existing.create_content_works) updates.create_content_works = v; }
          if (d.requires_approval !== undefined) { const v = parseBoolFieldNullable(d.requires_approval); if (v !== existing.requires_approval) updates.requires_approval = v; }
          if (d.is_published !== undefined) { const v = parseBoolFieldNullable(d.is_published); if (v !== existing.is_published) updates.is_published = v; }
          if (d.credentials !== undefined && d.credentials !== (existing.credentials || '')) updates.credentials = d.credentials || null;
          if (d.notes !== undefined && d.notes !== (existing.notes || '')) updates.notes = d.notes || null;

          if (d.url) {
            const parsed = extractDomain(d.url);
            if (parsed && parsed.url !== existing.url) {
              updates.url = parsed.url;
              updates.domain = parsed.domain;
            }
          }

          if (Object.keys(updates).length > 0) {
            db.updateSite(id, updates);
            updated++;
          } else {
            skipped++;
          }
        } catch (err) {
          errors.push(`ID ${item.id}: ${err.message}`);
          skipped++;
        }
      }

      res.json({ updated, skipped, errors });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  function parseBoolField(val) {
    if (val === null || val === undefined || val === '') return 1;
    if (typeof val === 'number') return val ? 1 : 0;
    const s = String(val).trim().toLowerCase();
    if (['yes', '1', 'true', 'y'].includes(s)) return 1;
    if (['no', '0', 'false', 'n'].includes(s)) return 0;
    return 1;
  }

  function parseBoolFieldNullable(val) {
    if (val === null || val === undefined || val === '') return null;
    if (typeof val === 'number') return val ? 1 : 0;
    const s = String(val).trim().toLowerCase();
    if (['yes', '1', 'true', 'y'].includes(s)) return 1;
    if (['no', '0', 'false', 'n'].includes(s)) return 0;
    if (['n/a', 'na', 'null', '-', 'unknown'].includes(s)) return null;
    return null;
  }

  // --- Export ---
  app.get('/api/export', authMiddleware, (req, res) => {
    let sites;
    const { range, from, to, days, category } = req.query;

    if (range === 'id' && from && to) {
      sites = db.getSitesByIdRange(parseInt(from), parseInt(to));
    } else if (range === 'days' && days) {
      sites = db.getSitesByDays(parseInt(days));
    } else if (range === 'category' && category) {
      sites = db.getSitesByCategory(category);
    } else {
      sites = db.getAllSites();
    }

    if (!sites.length) return res.status(404).json({ error: 'No sites found' });

    const data = sites.map(s => ({
      ID: s.id, URL: s.url, Domain: s.domain, Category: s.category,
      Working: boolLabel(s.is_working), 'Login Works': boolLabel(s.login_works),
      'Signup Works': boolLabel(s.signup_works), 'Create Content': boolLabel(s.create_content_works),
      'Requires Approval': boolLabel(s.requires_approval),
      'Published': boolLabel(s.is_published),
      Credentials: s.credentials || '', Notes: s.notes || '',
      Created: s.created_at, Updated: s.updated_at,
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Sites');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename=sites_export.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  });

  // --- Serve frontend ---
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
  });

  app.listen(config.WEB_PORT, '0.0.0.0', () => {
    console.log(`Admin panel running at http://0.0.0.0:${config.WEB_PORT}`);
  });
}

module.exports = { startWeb };
