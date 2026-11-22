/* Utilidades compartilhadas */
const money = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Erro de conexão. Tente novamente.'), { status: res.status });
  return data;
}

function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

const formatPhone = (p) => {
  const d = String(p).replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return p;
};

const BURGER_SVG = '<svg viewBox="0 0 64 64" fill="none" stroke="#ffc21a" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M10 28c0-10 10-17 22-17s22 7 22 17z"/><path d="M8 36h48"/><path d="M10 44h44a0 0 0 0 1 0 0c0 5-4 9-9 9H19c-5 0-9-4-9-9z"/><path d="M24 20h.01M32 17h.01M40 20h.01"/></svg>';

const PAY_LABELS = {
  pix: 'Pix (pague agora)',
  card: 'Cartão de crédito (pague agora)',
  cash: 'Dinheiro na entrega/retirada',
  card_on_delivery: 'Cartão na maquininha (na entrega/retirada)',
};

const STATUS_LABELS = {
  aguardando_pagamento: 'Aguardando pagamento',
  recebido: 'Pedido recebido',
  em_preparo: 'Em preparo',
  saiu_entrega: 'Saiu para entrega',
  pronto_retirada: 'Pronto para retirada',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};

const PAYMENT_STATUS_LABELS = {
  pendente: 'Pendente',
  aprovado: 'Pago',
  recusado: 'Recusado',
  cancelado: 'Cancelado',
  estornado: 'Estornado',
  na_entrega: 'Na entrega',
};
