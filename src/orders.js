const crypto = require('node:crypto');
const { db, getSettings } = require('./db');

const ONLINE_METHODS = ['pix', 'card'];
const ALL_METHODS = { pix: 'payPix', card: 'payCard', cash: 'payCashOnDelivery', card_on_delivery: 'payCardOnDelivery' };

class OrderError extends Error {
  constructor(msg) { super(msg); this.status = 400; }
}

const clean = (s, max = 200) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const norm = (s) => clean(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Monta o pedido a partir do carrinho, recalculando TODOS os preços no servidor. */
function buildOrder(input) {
  const settings = getSettings();
  if (!settings.isOpen) throw new OrderError('A loja está fechada no momento. Volte mais tarde!');

  const name = clean(input?.customer?.name, 80);
  const phone = clean(input?.customer?.phone, 20).replace(/\D/g, '');
  const email = clean(input?.customer?.email, 120).toLowerCase();
  if (name.length < 2) throw new OrderError('Informe seu nome.');
  if (phone.length < 10 || phone.length > 13) throw new OrderError('Informe um WhatsApp válido com DDD.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new OrderError('E-mail inválido.');

  const type = input?.type === 'pickup' ? 'pickup' : 'delivery';
  if (type === 'delivery' && !settings.deliveryEnabled) throw new OrderError('Entrega indisponível no momento.');
  if (type === 'pickup' && !settings.pickupEnabled) throw new OrderError('Retirada indisponível no momento.');

  let address = null;
  if (type === 'delivery') {
    const a = input.address || {};
    address = {
      cep: clean(a.cep, 9).replace(/\D/g, ''),
      street: clean(a.street, 120),
      number: clean(a.number, 20),
      complement: clean(a.complement, 80),
      neighborhood: clean(a.neighborhood, 80),
      city: clean(a.city, 80),
      state: clean(a.state, 2).toUpperCase(),
      reference: clean(a.reference, 120),
    };
    if (address.cep.length !== 8) throw new OrderError('CEP inválido.');
    if (!address.street || !address.number || !address.neighborhood || !address.city) {
      throw new OrderError('Preencha o endereço completo (rua, número e bairro).');
    }
    const cities = settings.deliveryCities.split(',').map(norm).filter(Boolean);
    if (cities.length && !cities.includes(norm(address.city))) {
      throw new OrderError(`Ainda não entregamos em ${address.city}. Escolha retirada no local.`);
    }
  }

  const method = String(input?.paymentMethod || '');
  if (!ALL_METHODS[method] || !settings[ALL_METHODS[method]]) throw new OrderError('Forma de pagamento indisponível.');
  if (ONLINE_METHODS.includes(method) && !email) throw new OrderError('Informe seu e-mail para pagar online (o comprovante é enviado para ele).');

  const rawItems = Array.isArray(input?.items) ? input.items.slice(0, 50) : [];
  if (!rawItems.length) throw new OrderError('Seu carrinho está vazio.');

  const getProduct = db.prepare('SELECT id, name, price_cents, accepts_addons FROM products WHERE id = ? AND active = 1');
  const getAddon = db.prepare('SELECT id, name, price_cents FROM addons WHERE id = ? AND active = 1');

  const items = rawItems.map((it) => {
    const p = getProduct.get(Number(it.productId));
    if (!p) throw new OrderError('Um dos itens do carrinho não está mais disponível. Atualize a página.');
    const qty = Math.min(20, Math.max(1, Math.floor(Number(it.qty) || 1)));
    const addonIds = p.accepts_addons ? [...new Set((it.addonIds || []).map(Number))].slice(0, 15) : [];
    const addons = addonIds.map((id) => {
      const a = getAddon.get(id);
      if (!a) throw new OrderError('Um adicional escolhido não está mais disponível.');
      return { id: a.id, name: a.name, price_cents: a.price_cents };
    });
    const unit = p.price_cents + addons.reduce((s, a) => s + a.price_cents, 0);
    return { productId: p.id, name: p.name, qty, addons, notes: clean(it.notes, 200), unit_cents: unit, total_cents: unit * qty };
  });

  const subtotal = items.reduce((s, i) => s + i.total_cents, 0);
  if (subtotal < settings.minOrderCents) {
    throw new OrderError(`Pedido mínimo de R$ ${(settings.minOrderCents / 100).toFixed(2).replace('.', ',')}.`);
  }
  const fee = type === 'delivery' ? settings.deliveryFeeCents : 0;
  const total = subtotal + fee;

  let changeFor = null;
  if (method === 'cash' && input.changeFor) {
    changeFor = Math.round(Number(String(input.changeFor).replace(',', '.')) * 100) || null;
    if (changeFor && changeFor < total) throw new OrderError('O valor para troco deve ser maior que o total.');
  }

  const online = ONLINE_METHODS.includes(method);
  const info = db.prepare(`
    INSERT INTO orders (public_token, status, payment_method, payment_status, customer_name, customer_phone, customer_email,
      order_type, address, items, notes, change_for_cents, subtotal_cents, delivery_fee_cents, total_cents)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    crypto.randomBytes(18).toString('base64url'),
    online ? 'aguardando_pagamento' : 'recebido',
    method,
    online ? 'pendente' : 'na_entrega',
    name, phone, email || null, type,
    address ? JSON.stringify(address) : null,
    JSON.stringify(items),
    clean(input.notes, 300) || null,
    changeFor, subtotal, fee, total,
  );
  return getOrder(info.lastInsertRowid);
}

function getOrder(id) {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(id));
  if (!o) return null;
  o.items = JSON.parse(o.items);
  o.address = o.address ? JSON.parse(o.address) : null;
  return o;
}

function getOrderByToken(id, token) {
  const o = getOrder(id);
  if (!o || !token) return null;
  const a = Buffer.from(o.public_token);
  const b = Buffer.from(String(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? o : null;
}

/** Aplica o resultado de um pagamento ao pedido. */
function applyPayment(orderId, { providerId, status, detail, amountCents }) {
  const o = getOrder(orderId);
  if (!o || !ONLINE_METHODS.includes(o.payment_method)) return o;
  if (o.payment_status === 'aprovado' && status !== 'estornado') return o; // já pago
  if (status === 'aprovado' && amountCents != null && amountCents < o.total_cents) {
    status = 'recusado';
    detail = 'valor_divergente';
  }
  let newStatus = o.status;
  if (status === 'aprovado' && o.status === 'aguardando_pagamento') newStatus = 'recebido';
  if (status === 'estornado') newStatus = 'cancelado';
  db.prepare(`UPDATE orders SET payment_status = ?, payment_provider_id = COALESCE(?, payment_provider_id),
    payment_detail = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(status, providerId || null, detail || null, newStatus, o.id);
  return getOrder(o.id);
}

/** Versão do pedido que pode ser mostrada ao cliente. */
function publicOrder(o, settings = getSettings()) {
  return {
    id: o.id,
    createdAt: o.created_at,
    status: o.status,
    paymentMethod: o.payment_method,
    paymentStatus: o.payment_status,
    paymentDetail: o.payment_detail,
    pix: o.pix_qr ? { qr: o.pix_qr, qrBase64: o.pix_qr_base64, expiresAt: o.pix_expires_at } : null,
    customer: { name: o.customer_name, phone: o.customer_phone, email: o.customer_email },
    type: o.order_type,
    address: o.address,
    items: o.items,
    notes: o.notes,
    changeForCents: o.change_for_cents,
    subtotalCents: o.subtotal_cents,
    deliveryFeeCents: o.delivery_fee_cents,
    totalCents: o.total_cents,
    estimate: o.order_type === 'delivery' ? settings.deliveryEstimate : settings.pickupEstimate,
  };
}

module.exports = { buildOrder, getOrder, getOrderByToken, applyPayment, publicOrder, OrderError, ONLINE_METHODS };
