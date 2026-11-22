// Testa a validação da assinatura do webhook do Mercado Pago
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

process.env.MP_WEBHOOK_SECRET = 'segredo-teste';
process.env.MP_ACCESS_TOKEN = 'TEST-token';
const mp = require('../src/payments/mercadopago');

function sign(id, requestId, ts, secret = 'segredo-teste') {
  const v1 = crypto.createHmac('sha256', secret).update(`id:${id};request-id:${requestId};ts:${ts};`).digest('hex');
  return { query: { 'data.id': id }, body: { data: { id } }, headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId } };
}

test('aceita assinatura válida', () => {
  assert.equal(mp.verifyWebhook(sign('123456', 'req-1', '1700000000')), true);
});

test('rejeita assinatura com segredo errado', () => {
  assert.equal(mp.verifyWebhook(sign('123456', 'req-1', '1700000000', 'outro')), false);
});

test('rejeita quando o id foi trocado', () => {
  const req = sign('123456', 'req-1', '1700000000');
  req.query['data.id'] = '999';
  assert.equal(mp.verifyWebhook(req), false);
});

test('rejeita sem cabeçalho', () => {
  assert.equal(mp.verifyWebhook({ query: {}, body: {}, headers: {} }), false);
});
