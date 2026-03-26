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
  app.use(express.json());
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

  // --- CRUD routes ---
  app.get('/api/sites', authMiddleware, (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const perPage = parseInt(req.query.perPage) || 20;
    const search = req.query.search || '';
    const category = req.query.category || '';

    if (search) {
      let results = db.searchSites(search);
      if (category) results = results.filter(s => s.category === category);
      const total = results.length;
      const sliced = results.slice((page - 1) * perPage, page * perPage);
      return res.json({ sites: sliced, total, page, totalPages: Math.ceil(total / perPage) });
    }

    if (category) {
      const all = db.getSitesByCategory(category);
      const total = all.length;
      const sliced = all.slice((page - 1) * perPage, page * perPage);
      return res.json({ sites: sliced, total, page, totalPages: Math.ceil(total / perPage) });
    }

    res.json(db.listSites(page, perPage));
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
    const fields = ['category', 'is_working', 'login_works', 'signup_works', 'create_content_works', 'requires_approval', 'credentials', 'notes'];
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
