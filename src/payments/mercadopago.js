// Integração Mercado Pago (Checkout Transparente): Pix com QR Code no site e cartão via Card Payment Brick.
// Docs: https://www.mercadopago.com.br/developers/pt/docs/checkout-api/overview
const crypto = require('node:crypto');
const config = require('../config');

const API = 'https://api.mercadopago.com';

async function mpFetch(path, { method = 'GET', body, idempotencyKey } = {}) {
  const headers = {
    Authorization: `Bearer ${config.MP_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || data.error || `HTTP ${res.status}`;
    const err = new Error(`Mercado Pago: ${msg}`);
    err.status = 502; // erro do gateway: o cliente vê uma mensagem genérica
    err.providerStatus = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

function mapStatus(s) {
  switch (s) {
    case 'approved': return 'aprovado';
    case 'rejected': return 'recusado';
    case 'cancelled': return 'cancelado';
    case 'refunded':
    case 'charged_back': return 'estornado';
    default: return 'pendente'; // pending, in_process, authorized, in_mediation
  }
}

function notificationUrl() {
  // O Mercado Pago só aceita URL pública HTTPS
  return config.BASE_URL.startsWith('https://') ? `${config.BASE_URL}/api/webhooks/mercadopago` : undefined;
}

function splitName(full) {
  const parts = String(full).trim().split(/\s+/);
  return { first_name: parts[0] || 'Cliente', last_name: parts.slice(1).join(' ') || undefined };
}

async function createPix(order) {
  const expires = new Date(Date.now() + 30 * 60e3);
  const data = await mpFetch('/v1/payments', {
    method: 'POST',
    idempotencyKey: `pix-${order.id}-${order.public_token}`,
    body: {
      transaction_amount: order.total_cents / 100,
      description: `Pedido #${order.id} - Papito's Burguer`,
      payment_method_id: 'pix',
      external_reference: String(order.id),
      notification_url: notificationUrl(),
      date_of_expiration: expires.toISOString().replace('Z', '-00:00'),
      payer: { email: order.customer_email, ...splitName(order.customer_name) },
    },
  });
  const td = data.point_of_interaction?.transaction_data || {};
  return {
    providerId: String(data.id),
    status: mapStatus(data.status),
    detail: data.status_detail,
    qr: td.qr_code,
    qrBase64: td.qr_code_base64,
    expiresAt: expires.toISOString(),
  };
}

async function createCard(order, form) {
  const data = await mpFetch('/v1/payments', {
    method: 'POST',
    idempotencyKey: `card-${order.id}-${crypto.randomUUID()}`,
    body: {
      // O valor SEMPRE vem do servidor, nunca do navegador
      transaction_amount: order.total_cents / 100,
      token: form.token,
      description: `Pedido #${order.id} - Papito's Burguer`,
      installments: Number(form.installments) || 1,
      payment_method_id: form.payment_method_id,
      issuer_id: form.issuer_id || undefined,
      external_reference: String(order.id),
      notification_url: notificationUrl(),
      statement_descriptor: 'PAPITOSBURGUER',
      payer: {
        email: form.payer?.email || order.customer_email,
        identification: form.payer?.identification,
        ...splitName(order.customer_name),
      },
    },
  });
  return { providerId: String(data.id), status: mapStatus(data.status), detail: data.status_detail };
}

async function getPayment(id) {
  const data = await mpFetch(`/v1/payments/${encodeURIComponent(id)}`);
  return {
    providerId: String(data.id),
    status: mapStatus(data.status),
    detail: data.status_detail,
    amountCents: Math.round(Number(data.transaction_amount) * 100),
    externalReference: data.external_reference,
  };
}

// Valida a assinatura x-signature enviada pelo Mercado Pago
// https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
function verifyWebhook(req) {
  if (!config.MP_WEBHOOK_SECRET) return true; // sem segredo configurado: confiamos apenas na consulta à API
  const sig = String(req.headers['x-signature'] || '');
  const requestId = String(req.headers['x-request-id'] || '');
  const parts = Object.fromEntries(sig.split(',').map((p) => p.trim().split('=')));
  if (!parts.ts || !parts.v1) return false;
  let dataId = String(req.query['data.id'] || req.body?.data?.id || '');
  if (/^[a-z0-9]+$/i.test(dataId)) dataId = dataId.toLowerCase();
  let manifest = '';
  if (dataId) manifest += `id:${dataId};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${parts.ts};`;
  const expected = crypto.createHmac('sha256', config.MP_WEBHOOK_SECRET).update(manifest).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(parts.v1));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  name: 'mercadopago',
  live: true,
  publicKey: () => config.MP_PUBLIC_KEY,
  createPix,
  createCard,
  getPayment,
  verifyWebhook,
};
