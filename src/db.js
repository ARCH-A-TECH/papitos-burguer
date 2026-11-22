const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');
const { hashPassword } = require('./auth-utils');

fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(config.DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL,
  image TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  featured INTEGER NOT NULL DEFAULT 0,
  accepts_addons INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS addons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  payment_provider_id TEXT,
  payment_detail TEXT,
  pix_qr TEXT,
  pix_qr_base64 TEXT,
  pix_expires_at TEXT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  order_type TEXT NOT NULL,
  address TEXT,
  items TEXT NOT NULL,
  notes TEXT,
  change_for_cents INTEGER,
  subtotal_cents INTEGER NOT NULL,
  delivery_fee_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
`);

// ---------- Configurações da loja ----------
const DEFAULT_SETTINGS = {
  storeName: "Papito's Burguer",
  tagline: 'Hambúrguer artesanal • Delivery & Retirada',
  whatsapp: '5563992438018',
  instagram: 'papitosburguerr',
  isOpen: true,
  hoursText: '',
  pickupAddress: '',
  deliveryEnabled: true,
  pickupEnabled: true,
  deliveryFeeCents: 500,
  minOrderCents: 0,
  // Cidades atendidas (separadas por vírgula). Vazio = aceita qualquer CEP.
  deliveryCities: '',
  deliveryEstimate: '40–60 min',
  pickupEstimate: '20–30 min',
  payPix: true,
  payCard: true,
  payCashOnDelivery: true,
  payCardOnDelivery: true,
};

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key in DEFAULT_SETTINGS) {
      try { out[r.key] = JSON.parse(r.value); } catch { /* ignora valor inválido */ }
    }
  }
  return out;
}

function saveSettings(patch) {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    const def = DEFAULT_SETTINGS[k];
    let val = v;
    if (typeof def === 'boolean') val = Boolean(v);
    else if (typeof def === 'number') { val = Math.max(0, Math.round(Number(v) || 0)); }
    else val = String(v ?? '').slice(0, 500);
    stmt.run(k, JSON.stringify(val));
  }
  return getSettings();
}

// ---------- Dados iniciais (cardápio atual) ----------
function seed() {
  const hasCats = db.prepare('SELECT COUNT(*) n FROM categories').get().n > 0;
  if (!hasCats) {
    const insCat = db.prepare('INSERT INTO categories (name, sort) VALUES (?, ?)');
    const insProd = db.prepare('INSERT INTO products (category_id, name, description, price_cents, image, featured, sort) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const menu = [
      ['Lanches Especiais', [
        ['X-Papitos', '2 hambúrgueres, 2 camadas de queijo, 2 camadas de bacon e cheddar.', 3699, '/img/x-papitos.jpg', 1],
        ['X-Papitos Supremo', 'Hambúrguer recheado com queijo no meio, mais queijo em cima, bacon e cheddar.', 3799, null, 1],
      ]],
      ['Burguer Bovino', [
        ['X-Burguer', 'Hambúrguer bovino, presunto e queijo.', 1399],
        ['X-Salada', 'Hambúrguer bovino, presunto, queijo, alface e tomate.', 1499],
        ['X-Egg', 'Hambúrguer bovino, presunto, queijo, ovo, alface e tomate.', 1599],
        ['X-Bacon', 'Hambúrguer bovino, presunto, queijo, bacon, alface e tomate.', 1899],
        ['X-Tudão', 'Hambúrguer bovino, presunto, queijo, salsicha, calabresa, bacon, ovo, catupiry, cheddar, alface e tomate.', 2799],
        ['X-Tudão Duplo', '2 hambúrgueres bovinos, presunto, queijo, salsicha, calabresa, bacon, 2 ovos, catupiry, cheddar, alface e tomate.', 3499],
      ]],
      ['Calabresa', [
        ['X-Calabresa', 'Calabresa, presunto e queijo.', 1399],
        ['X-Calabresa Salada', 'Calabresa, presunto, queijo, alface e tomate.', 1499],
        ['X-Calabresa Egg', 'Calabresa, presunto, queijo, ovo, alface e tomate.', 1599],
        ['X-Calabresa Bacon', 'Calabresa, presunto, queijo, bacon, alface e tomate.', 1899],
      ]],
    ];
    menu.forEach(([cat, items], ci) => {
      const catId = insCat.run(cat, ci + 1).lastInsertRowid;
      items.forEach(([name, desc, price, img = null, featured = 0], pi) => insProd.run(catId, name, desc, price, img, featured, pi + 1));
    });
  }

  const hasAddons = db.prepare('SELECT COUNT(*) n FROM addons').get().n > 0;
  if (!hasAddons) {
    const ins = db.prepare('INSERT INTO addons (name, price_cents, sort) VALUES (?, ?, ?)');
    [['Bacon', 500], ['Calabresa', 500], ['Catupiry', 500], ['Cheddar', 500], ['Ovo', 350], ['Queijo', 500], ['Presunto', 500], ['Hambúrguer bovino', 700]]
      .forEach(([n, p], i) => ins.run(n, p, i + 1));
  }

  const hasAdmin = db.prepare('SELECT COUNT(*) n FROM admins').get().n > 0;
  if (!hasAdmin) {
    let password = config.ADMIN_PASSWORD;
    if (!password) {
      password = crypto.randomBytes(6).toString('base64url');
      console.log('\n==============================================');
      console.log(' Usuário administrador criado');
      console.log(`   usuário: ${config.ADMIN_USER}`);
      console.log(`   senha:   ${password}`);
      console.log(' Anote e troque a senha no painel (/admin).');
      console.log('==============================================\n');
    }
    db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(config.ADMIN_USER, hashPassword(password));
  }
}

seed();

// Transação simples
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { db, getSettings, saveSettings, tx, DEFAULT_SETTINGS };
