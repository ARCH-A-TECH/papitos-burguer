const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const { db, getSettings, saveSettings } = require('../db');
const auth = require('../auth');
const { hashPassword, verifyPassword } = require('../auth-utils');
const orders = require('../orders');

const router = express.Router();

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const toCents = (v) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 100000) throw new HttpError(400, 'Preço inválido.');
  return Math.round(n * 100);
};
const text = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
const int = (v) => Math.max(0, Math.min(9999, Math.floor(Number(v) || 0)));

// ---------- Autenticação ----------
router.post('/login', (req, res) => {
  if (auth.loginRateLimited(req.ip)) throw new HttpError(429, 'Muitas tentativas. Aguarde 15 minutos.');
  const admin = auth.login(req.body?.username, req.body?.password);
  if (!admin) throw new HttpError(401, 'Usuário ou senha incorretos.');
  auth.createSession(res, admin.id);
  res.json({ ok: true, username: admin.username });
});

router.post('/logout', (req, res) => { auth.destroySession(req, res); res.json({ ok: true }); });

router.get('/me', (req, res) => {
  const admin = auth.getAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Não autenticado.' });
  res.json({ username: admin.username });
});

router.use(auth.requireAdmin);

router.post('/password', (req, res) => {
  const row = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  if (!verifyPassword(req.body?.current || '', row.password_hash)) throw new HttpError(400, 'Senha atual incorreta.');
  const next = String(req.body?.next || '');
  if (next.length < 8) throw new HttpError(400, 'A nova senha precisa ter pelo menos 8 caracteres.');
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(next), row.id);
  res.json({ ok: true });
});

// ---------- Categorias ----------
router.get('/categories', (req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY sort, id').all());
});
router.post('/categories', (req, res) => {
  const name = text(req.body?.name, 60);
  if (!name) throw new HttpError(400, 'Informe o nome da categoria.');
  const r = db.prepare('INSERT INTO categories (name, sort, active) VALUES (?, ?, ?)').run(name, int(req.body.sort), req.body.active === undefined ? 1 : bool(req.body.active));
  res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(r.lastInsertRowid));
});
router.put('/categories/:id', (req, res) => {
  const name = text(req.body?.name, 60);
  if (!name) throw new HttpError(400, 'Informe o nome da categoria.');
  const r = db.prepare('UPDATE categories SET name = ?, sort = ?, active = ? WHERE id = ?').run(name, int(req.body.sort), bool(req.body.active), Number(req.params.id));
  if (!r.changes) throw new HttpError(404, 'Categoria não encontrada.');
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(req.params.id)));
});
router.delete('/categories/:id', (req, res) => {
  const n = db.prepare('SELECT COUNT(*) n FROM products WHERE category_id = ?').get(Number(req.params.id)).n;
  if (n) throw new HttpError(400, `Esta categoria tem ${n} produto(s). Mova ou exclua os produtos antes.`);
  db.prepare('DELETE FROM categories WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- Produtos ----------
const productSelect = 'SELECT * FROM products';
router.get('/products', (req, res) => {
  res.json(db.prepare(`${productSelect} ORDER BY category_id, sort, id`).all());
});

function productFields(b) {
  const name = text(b?.name, 80);
  if (!name) throw new HttpError(400, 'Informe o nome do produto.');
  const categoryId = Number(b.category_id) || null;
  if (categoryId && !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(categoryId)) throw new HttpError(400, 'Categoria inválida.');
  return [categoryId, name, text(b.description, 400), toCents(b.price), bool(b.active ?? 1), bool(b.featured), bool(b.accepts_addons ?? 1), int(b.sort)];
}

router.post('/products', (req, res) => {
  const f = productFields(req.body);
  const r = db.prepare(`INSERT INTO products (category_id, name, description, price_cents, active, featured, accepts_addons, sort)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(...f);
  res.status(201).json(db.prepare(`${productSelect} WHERE id = ?`).get(r.lastInsertRowid));
});
router.put('/products/:id', (req, res) => {
  const f = productFields(req.body);
  const r = db.prepare(`UPDATE products SET category_id = ?, name = ?, description = ?, price_cents = ?, active = ?, featured = ?,
    accepts_addons = ?, sort = ? WHERE id = ?`).run(...f, Number(req.params.id));
  if (!r.changes) throw new HttpError(404, 'Produto não encontrado.');
  res.json(db.prepare(`${productSelect} WHERE id = ?`).get(Number(req.params.id)));
});
// Atalho para ligar/desligar (ex.: acabou o ingrediente)
router.patch('/products/:id', (req, res) => {
  if ('active' in (req.body || {})) db.prepare('UPDATE products SET active = ? WHERE id = ?').run(bool(req.body.active), Number(req.params.id));
  if ('price' in (req.body || {})) db.prepare('UPDATE products SET price_cents = ? WHERE id = ?').run(toCents(req.body.price), Number(req.params.id));
  const p = db.prepare(`${productSelect} WHERE id = ?`).get(Number(req.params.id));
  if (!p) throw new HttpError(404, 'Produto não encontrado.');
  res.json(p);
});

function removeUpload(image) {
  if (image && image.startsWith('/uploads/')) {
    fs.rm(path.join(config.UPLOAD_DIR, path.basename(image)), { force: true }, () => {});
  }
}

router.delete('/products/:id', (req, res) => {
  const p = db.prepare(`${productSelect} WHERE id = ?`).get(Number(req.params.id));
  if (!p) throw new HttpError(404, 'Produto não encontrado.');
  db.prepare('DELETE FROM products WHERE id = ?').run(p.id);
  removeUpload(p.image);
  res.json({ ok: true });
});

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: config.UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${EXT[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(EXT[file.mimetype] ? null : new HttpError(400, 'Envie uma imagem JPG, PNG ou WEBP.'), Boolean(EXT[file.mimetype])),
});

router.post('/products/:id/image', upload.single('image'), (req, res) => {
  const p = db.prepare(`${productSelect} WHERE id = ?`).get(Number(req.params.id));
  if (!p) { if (req.file) fs.rm(req.file.path, { force: true }, () => {}); throw new HttpError(404, 'Produto não encontrado.'); }
  if (!req.file) throw new HttpError(400, 'Nenhuma imagem enviada.');
  const url = `/uploads/${req.file.filename}`;
  db.prepare('UPDATE products SET image = ? WHERE id = ?').run(url, p.id);
  removeUpload(p.image);
  res.json(db.prepare(`${productSelect} WHERE id = ?`).get(p.id));
});
router.delete('/products/:id/image', (req, res) => {
  const p = db.prepare(`${productSelect} WHERE id = ?`).get(Number(req.params.id));
  if (!p) throw new HttpError(404, 'Produto não encontrado.');
  db.prepare('UPDATE products SET image = NULL WHERE id = ?').run(p.id);
  removeUpload(p.image);
  res.json({ ok: true });
});

// ---------- Adicionais ----------
router.get('/addons', (req, res) => res.json(db.prepare('SELECT * FROM addons ORDER BY sort, id').all()));
router.post('/addons', (req, res) => {
  const name = text(req.body?.name, 60);
  if (!name) throw new HttpError(400, 'Informe o nome do adicional.');
  const r = db.prepare('INSERT INTO addons (name, price_cents, active, sort) VALUES (?, ?, ?, ?)')
    .run(name, toCents(req.body.price), req.body.active === undefined ? 1 : bool(req.body.active), int(req.body.sort));
  res.status(201).json(db.prepare('SELECT * FROM addons WHERE id = ?').get(r.lastInsertRowid));
});
router.put('/addons/:id', (req, res) => {
  const name = text(req.body?.name, 60);
  if (!name) throw new HttpError(400, 'Informe o nome do adicional.');
  const r = db.prepare('UPDATE addons SET name = ?, price_cents = ?, active = ?, sort = ? WHERE id = ?')
    .run(name, toCents(req.body.price), bool(req.body.active), int(req.body.sort), Number(req.params.id));
  if (!r.changes) throw new HttpError(404, 'Adicional não encontrado.');
  res.json(db.prepare('SELECT * FROM addons WHERE id = ?').get(Number(req.params.id)));
});
router.delete('/addons/:id', (req, res) => {
  db.prepare('DELETE FROM addons WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- Configurações ----------
router.get('/settings', (req, res) => res.json(getSettings()));
router.put('/settings', (req, res) => res.json(saveSettings(req.body || {})));

// ---------- Pedidos ----------
const ORDER_STATUSES = ['aguardando_pagamento', 'recebido', 'em_preparo', 'saiu_entrega', 'pronto_retirada', 'concluido', 'cancelado'];

router.get('/orders', (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 2));
  const rows = db.prepare(`SELECT id FROM orders WHERE created_at >= datetime('now', ?) ORDER BY id DESC LIMIT 300`).all(`-${days} days`);
  const settings = getSettings();
  res.set('Cache-Control', 'no-store');
  res.json(rows.map((r) => orders.publicOrder(orders.getOrder(r.id), settings)));
});

router.put('/orders/:id/status', (req, res) => {
  const status = String(req.body?.status || '');
  if (!ORDER_STATUSES.includes(status)) throw new HttpError(400, 'Status inválido.');
  const r = db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, Number(req.params.id));
  if (!r.changes) throw new HttpError(404, 'Pedido não encontrado.');
  res.json(orders.publicOrder(orders.getOrder(req.params.id)));
});

module.exports = router;
