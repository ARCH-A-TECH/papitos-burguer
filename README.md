# Papito's Burguer — Cardápio online

Cardápio digital com carrinho, entrega com busca por CEP, pagamento online (Pix e cartão via Mercado Pago) e painel para o dono gerenciar produtos, preços e pedidos.

## O que tem

**Para o cliente** (`/`)
- Cardápio por categorias (Lanches Especiais, Burguer Bovino, Calabresa) com fotos.
- Adicionais por lanche (bacon, cheddar, ovo…) e campo de observação ("sem tomate").
- Carrinho salvo no navegador.
- Entrega ou retirada. Na entrega, o endereço é preenchido pelo CEP (ViaCEP, com a BrasilAPI de reserva). Se as duas estiverem fora do ar, o cliente digita o endereço à mão.
- Pagamento:
  - **Pix**: QR Code e "copia e cola" na própria página. A confirmação é automática.
  - **Cartão de crédito**: formulário seguro do Mercado Pago dentro do site. Os dados do cartão não passam pelo servidor.
  - Dinheiro (com troco) ou maquininha na entrega/retirada.
- Página de acompanhamento do pedido, que se atualiza sozinha, com botão para enviar o pedido pelo WhatsApp.

**Para o dono** (`/admin`)
- Login com usuário e senha.
- **Pedidos** em tempo real (atualiza a cada 10 s, com som de alerta), troca de status e total faturado no dia.
- **Produtos**: criar, editar, excluir, trocar foto, mudar o preço direto na lista e pausar um item quando acaba o ingrediente.
- **Adicionais** e **Categorias**.
- **Configurações**: abrir/fechar a loja, taxa de entrega, pedido mínimo, cidades atendidas, tempos de entrega, formas de pagamento, WhatsApp/Instagram e troca de senha.

## Rodar no computador

Requer Node.js 22.13 ou mais recente.

```bash
npm install
cp .env.example .env     # edite ADMIN_PASSWORD
npm start
```

- Site: http://localhost:3000
- Painel: http://localhost:3000/admin (usuário `admin` e a senha do `.env`)

Sem as chaves do Mercado Pago, o site roda em **modo demonstração**: o fluxo inteiro funciona, mas o pagamento é simulado por um botão.

## Ligar o Mercado Pago

1. Crie uma aplicação em https://www.mercadopago.com.br/developers/panel/app e escolha *Checkout Transparente / Pagamentos online*.
2. Copie o **Access Token** e a **Public Key** para `MP_ACCESS_TOKEN` e `MP_PUBLIC_KEY`. Comece pelas credenciais de **teste**.
3. Em *Webhooks*, cadastre a URL `https://SEU-DOMINIO/api/webhooks/mercadopago` com o evento **Pagamentos**. Copie a *assinatura secreta* para `MP_WEBHOOK_SECRET`.
4. Preencha `BASE_URL` com o endereço público do site (HTTPS).
5. Antes de publicar, teste com os [cartões de teste](https://www.mercadopago.com.br/developers/pt/docs/checkout-api/integration-test/test-cards). Depois troque pelas credenciais de produção.

> Pix: a conta Mercado Pago precisa ter uma **chave Pix cadastrada** para gerar QR Codes.

O site também consulta o status do pagamento enquanto o cliente está na página do pedido. Se um webhook atrasar, o pedido é confirmado do mesmo jeito.

## Publicar (hospedagem)

O site é um único servidor Node com banco SQLite. A hospedagem precisa ter **disco persistente** para a pasta `data/` (banco + fotos):

- **Railway / Render / Fly.io**: use o `Dockerfile`, monte um volume em `/app/data` e configure as variáveis do `.env.example`.
- **VPS** (Hostinger, DigitalOcean, Contabo…): `npm ci && npm start` atrás de Nginx/Caddy com HTTPS, ou `docker build -t papitos . && docker run -d -p 3000:3000 -v papitos-data:/app/data --env-file .env papitos`.

Faça backup periódico da pasta `data/`.

## Estrutura

```
server.js                 servidor Express
src/db.js                 banco SQLite, configurações e cardápio inicial
src/orders.js             montagem do pedido (preços sempre recalculados no servidor)
src/routes/public.js      API do cardápio, pedidos, pagamento e webhook
src/routes/admin.js       API do painel
src/payments/             Mercado Pago + modo demonstração (fácil trocar de gateway)
public/                   site do cliente (index.html, pedido.html) e painel (admin/)
test/                     testes (npm test)
```

### Trocar de gateway de pagamento
Crie `src/payments/<gateway>.js` com as funções `createPix`, `createCard`, `getPayment` e `verifyWebhook` (veja `mercadopago.js`) e selecione o arquivo em `src/payments/index.js`.

## Segurança
- O preço de cada item é recalculado no servidor. O valor enviado pelo navegador é ignorado.
- Um pagamento só é aceito se o valor pago for igual ou maior que o total do pedido.
- O webhook é validado pela assinatura e sempre confirmado consultando a API do Mercado Pago.
- A senha do painel é guardada com hash scrypt. A sessão usa cookie `HttpOnly`/`SameSite` e o login tem limite de tentativas.
