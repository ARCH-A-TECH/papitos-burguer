// Testa o cálculo do pedido (preços sempre recalculados no servidor)
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'papitos-test-'));
process.env.ADMIN_PASSWORD = 'senha-de-teste';
const { db } = require('../src/db');
const orders = require('../src/orders');

const xPapitos = db.prepare("SELECT id FROM products WHERE name = 'X-Papitos'").get().id;
const bacon = db.prepare("SELECT id FROM addons WHERE name = 'Bacon'").get().id;
const base = {
  type: 'delivery', paymentMethod: 'pix',
  customer: { name: 'Cliente Teste', phone: '63999991234', email: 'cliente@example.com' },
  address: { cep: '77001000', street: 'Rua A', number: '1', neighborhood: 'Centro', city: 'Palmas', state: 'TO' },
};

test('ignora preço enviado pelo navegador e soma adicionais + taxa', () => {
  const o = orders.buildOrder({ ...base, items: [{ productId: xPapitos, qty: 2, addonIds: [bacon], priceCents: 1 }] });
  assert.equal(o.subtotal_cents, (3699 + 500) * 2);
  assert.equal(o.total_cents, (3699 + 500) * 2 + 500);
  assert.equal(o.status, 'aguardando_pagamento');
});

test('pagamento com valor menor que o total é recusado', () => {
  const o = orders.buildOrder({ ...base, items: [{ productId: xPapitos, qty: 1 }] });
  const r = orders.applyPayment(o.id, { status: 'aprovado', amountCents: 100 });
  assert.equal(r.payment_status, 'recusado');
  const ok = orders.applyPayment(o.id, { status: 'aprovado', amountCents: o.total_cents });
  assert.equal(ok.payment_status, 'aprovado');
  assert.equal(ok.status, 'recebido');
});

test('exige e-mail para pagamento online', () => {
  assert.throws(() => orders.buildOrder({ ...base, customer: { ...base.customer, email: '' }, items: [{ productId: xPapitos, qty: 1 }] }), /e-mail/);
});

test('carrinho vazio é rejeitado', () => {
  assert.throws(() => orders.buildOrder({ ...base, items: [] }), /vazio/);
});
