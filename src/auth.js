const crypto = require('node:crypto');
const { db } = require('./db');
const config = require('./config');
const { verifyPassword, sha256 } = require('./auth-utils');

const COOKIE = 'papitos_admin';
const SESSION_DAYS = 7;

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createSession(res, adminId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_DAYS * 864e5;
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), adminId, expires);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.IS_PROD,
    maxAge: SESSION_DAYS * 864e5,
    path: '/',
  });
}

function getAdmin(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const row = db.prepare(`
    SELECT a.id, a.username FROM sessions s JOIN admins a ON a.id = s.admin_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).get(sha256(token), Date.now());
  return row || null;
}

function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(COOKIE, { path: '/' });
}

function requireAdmin(req, res, next) {
  const admin = getAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Faça login para continuar.' });
  req.admin = admin;
  next();
}

// Limite simples de tentativas de login (por IP)
const attempts = new Map();
function loginRateLimited(ip) {
  const now = Date.now();
  const a = attempts.get(ip) || { n: 0, until: 0, first: now };
  if (a.until > now) return true;
  if (now - a.first > 15 * 60e3) { a.n = 0; a.first = now; }
  a.n += 1;
  if (a.n > 8) { a.until = now + 15 * 60e3; a.n = 0; a.first = now; }
  attempts.set(ip, a);
  return a.until > now;
}

function login(username, password) {
  const row = db.prepare('SELECT * FROM admins WHERE username = ?').get(String(username || ''));
  if (!row || !verifyPassword(password || '', row.password_hash)) return null;
  return { id: row.id, username: row.username };
}

module.exports = { createSession, getAdmin, destroySession, requireAdmin, loginRateLimited, login };
