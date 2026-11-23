const path = require('node:path');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));

module.exports = {
  PORT: Number(process.env.PORT || 3000),
  // URL pública do site (usada nos webhooks do Mercado Pago). Ex.: https://papitosburguer.com.br
  // No Render, se BASE_URL não for definida, usa o endereço .onrender.com que o próprio Render informa.
  BASE_URL: (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, ''),
  IS_PROD: process.env.NODE_ENV === 'production',
  DATA_DIR,
  UPLOAD_DIR: path.join(DATA_DIR, 'uploads'),
  DB_FILE: path.join(DATA_DIR, 'papitos.db'),

  ADMIN_USER: process.env.ADMIN_USER || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',

  // Mercado Pago — sem estas chaves o site roda em "modo demonstração" (pagamento simulado)
  MP_ACCESS_TOKEN: process.env.MP_ACCESS_TOKEN || '',
  MP_PUBLIC_KEY: process.env.MP_PUBLIC_KEY || '',
  MP_WEBHOOK_SECRET: process.env.MP_WEBHOOK_SECRET || '',
};
