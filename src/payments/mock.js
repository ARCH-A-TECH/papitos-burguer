// Provedor de DEMONSTRAÇÃO — usado automaticamente quando o Mercado Pago não está configurado.
// Nenhum dinheiro é movimentado; serve para testar o fluxo completo do pedido.
const crypto = require('node:crypto');

module.exports = {
  name: 'demo',
  live: false,
  publicKey: () => '',
  async createPix(order) {
    return {
      providerId: `demo-${crypto.randomUUID()}`,
      status: 'pendente',
      qr: `00020126DEMONSTRACAO-PEDIDO-${order.id}-NAO-PAGUE-ESTE-CODIGO`,
      qrBase64: null,
      expiresAt: new Date(Date.now() + 30 * 60e3).toISOString(),
    };
  },
  async createCard() {
    return { providerId: `demo-${crypto.randomUUID()}`, status: 'aprovado', detail: 'demo' };
  },
  async getPayment() { return null; },
  verifyWebhook() { return false; },
};
