// Escolhe o provedor de pagamento. Para trocar de gateway (Asaas, PagBank, Efí, Stripe...),
// basta criar um arquivo com a mesma interface (createPix, createCard, getPayment, verifyWebhook).
const config = require('../config');

const provider = config.MP_ACCESS_TOKEN ? require('./mercadopago') : require('./mock');

if (!provider.live) {
  console.log('[pagamentos] Mercado Pago não configurado — rodando em MODO DEMONSTRAÇÃO (pagamentos simulados).');
}

module.exports = provider;
