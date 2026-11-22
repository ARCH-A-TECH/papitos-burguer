const path = require('node:path');
const express = require('express');
const config = require('./src/config');
require('./src/db'); // cria o banco e os dados iniciais

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
  });
  next();
});

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' })); // notificações antigas do Mercado Pago

app.use('/api/admin', require('./src/routes/admin'));
app.use('/api', require('./src/routes/public'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

app.use('/uploads', express.static(config.UPLOAD_DIR, { maxAge: '30d', immutable: true }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: config.IS_PROD ? '1h' : 0 }));

// Tratamento de erros
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || (err.code === 'LIMIT_FILE_SIZE' ? 400 : 500);
  if (status >= 500) console.error(err);
  const message = err.code === 'LIMIT_FILE_SIZE' ? 'Imagem muito grande (máx. 5 MB).'
    : status >= 500 ? (err.message?.startsWith('Mercado Pago') ? 'Não foi possível processar o pagamento agora. Tente novamente.' : 'Erro interno. Tente novamente.')
      : err.message;
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
});

app.listen(config.PORT, () => {
  console.log(`Papito's Burguer rodando em http://localhost:${config.PORT}`);
  console.log(`Painel do dono: http://localhost:${config.PORT}/admin`);
});
