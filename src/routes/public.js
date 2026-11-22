const express = require('express');
const { db, getSettings } = require('../db');
const payments = require('../payments');
const orders = require('../orders');

const router = express.Router();

function publicSettings(s) {
  const { storeName, tagline, whatsapp, instagram, isOpen, hoursText, pickupAddress, deliveryEnabled, pickupEnabled,
    deliveryFeeCents, minOrderCents, deliveryCities, deliveryEstimate, pickupEstimate,
    payPix, payCard, payCashOnDelivery, payCardOnDelivery } = s;
  return { storeName, tagline, whatsapp, instagram, isOpen, hoursText, pickupAddress, deliveryEnabled, pickupEnabled,
    deliveryFeeCents, minOrderCents, deliveryCities, deliveryEstimate, pickupEstimate,
    payPix, payCard, payCashOnDelivery, payCardOnDelivery };
}

router.get('/menu', (req, res) => {
  const categories = db.prepare('SELECT id, name FROM categories WHERE active = 1 ORDER BY sort, id').all();
  const products = db.prepare(`SELECT id, category_id AS categoryId, name, description, price_cents AS priceCents,
    image, featured, accepts_addons AS acceptsAddons FROM products WHERE active = 1 ORDER BY sort, id`).all();
  const addons = db.prepare('SELECT id, name, price_cents AS priceCents FROM addons WHERE active = 1 ORDER BY sort, id').all();
  const known = new Set(categories.map((c) => c.id));
  if (products.some((p) => !known.has(p.categoryId))) {
    categories.push({ id: 0, name: 'Outros' });
    products.forEach((p) => { if (!known.has(p.categoryId)) p.categoryId = 0; });
  }
  res.set('Cache-Control', 'no-store');
  res.json({
    settings: publicSettings(getSettings()),
    categories: categories.map((c) => ({ ...c, products: products.filter((p) => p.categoryId === c.id) })).filter((c) => c.products.length),
    addons,
    payment: { provider: payments.name, live: payments.live, publicKey: payments.publicKey() },
  });
});

router.post('/orders', (req, res) => {
  const o = orders.buildOrder(req.body);
  res.status(201).json({ id: o.id, token: o.public_token });
});

function loadOrder(req, res) {
  const o = orders.getOrderByToken(req.params.id, req.query.t);
  if (!o) { res.status(404).json({ error: 'Pedido não encontrado.' }); return null; }
  return o;
}

// Quando o webhook não está configurado (ou atrasou), consulta o status direto no gateway.
const lastCheck = new Map();
async function syncPayment(o) {
  if (!payments.live || !o.payment_provider_id || o.payment_status !== 'pendente') return o;
  const now = Date.now();
  if (now - (lastCheck.get(o.id) || 0) < 5000) return o;
  lastCheck.set(o.id, now);
  try {
    const p = await payments.getPayment(o.payment_provider_id);
    if (p && String(p.externalReference) === String(o.id)) return orders.applyPayment(o.id, p);
  } catch (e) { console.error('[pagamentos] falha ao consultar status:', e.message); }
  return o;
}

router.get('/orders/:id', async (req, res) => {
  let o = loadOrder(req, res);
  if (!o) return;
  o = await syncPayment(o);
  res.set('Cache-Control', 'no-store');
  res.json({ order: orders.publicOrder(o), payment: { provider: payments.name, live: payments.live, publicKey: payments.publicKey() } });
});

function assertPayable(o, method) {
  if (o.payment_method !== method) throw new orders.OrderError('Forma de pagamento diferente da escolhida no pedido.');
  if (o.payment_status === 'aprovado') throw new orders.OrderError('Este pedido já foi pago.');
  if (o.status === 'cancelado') throw new orders.OrderError('Este pedido foi cancelado.');
}

router.post('/orders/:id/pix', async (req, res) => {
  const o = loadOrder(req, res);
  if (!o) return;
  assertPayable(o, 'pix');
  // Reaproveita o QR Code se ainda estiver válido
  if (o.pix_qr && o.pix_expires_at && new Date(o.pix_expires_at) > new Date(Date.now() + 60e3)) {
    return res.json({ order: orders.publicOrder(o) });
  }
  const pix = await payments.createPix(o);
  db.prepare(`UPDATE orders SET payment_provider_id = ?, pix_qr = ?, pix_qr_base64 = ?, pix_expires_at = ?,
    payment_status = 'pendente', updated_at = datetime('now') WHERE id = ?`)
    .run(pix.providerId, pix.qr, pix.qrBase64, pix.expiresAt, o.id);
  res.json({ order: orders.publicOrder(orders.getOrder(o.id)) });
});

router.post('/orders/:id/card', async (req, res) => {
  const o = loadOrder(req, res);
  if (!o) return;
  assertPayable(o, 'card');
  if (payments.live && !req.body?.token) throw new orders.OrderError('Dados do cartão inválidos.');
  const r = await payments.createCard(o, req.body || {});
  const updated = orders.applyPayment(o.id, r);
  res.json({ order: orders.publicOrder(updated) });
});

// Apenas no modo demonstração: simula a confirmação do Pix
router.post('/orders/:id/demo-pay', (req, res) => {
  if (payments.live) return res.status(404).json({ error: 'Indisponível.' });
  const o = loadOrder(req, res);
  if (!o) return;
  const updated = orders.applyPayment(o.id, { status: 'aprovado', detail: 'demo', amountCents: o.total_cents });
  res.json({ order: orders.publicOrder(updated) });
});

// Webhook do Mercado Pago
router.post('/webhooks/mercadopago', async (req, res) => {
  if (!payments.live) return res.sendStatus(200);
  if (!payments.verifyWebhook(req)) return res.sendStatus(401);
  const type = req.body?.type || req.query.type || req.query.topic;
  const id = req.body?.data?.id || req.query['data.id'] || req.query.id;
  if (type === 'payment' && id) {
    try {
      // Nunca confiamos no corpo da notificação: buscamos o pagamento direto na API
      const p = await payments.getPayment(id);
      if (p?.externalReference) orders.applyPayment(Number(p.externalReference), p);
    } catch (e) {
      console.error('[webhook] erro:', e.message);
      return res.sendStatus(500); // o Mercado Pago tenta novamente
    }
  }
  res.sendStatus(200);
});

module.exports = router;
