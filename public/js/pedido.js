/* Acompanhamento do pedido + pagamento (Pix / cartão) */
(() => {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const token = params.get('t');
  const root = document.getElementById('root');
  const q = `?t=${encodeURIComponent(token || '')}`;

  let order = null;
  let payment = null;
  let pollTimer = null;
  let brickMounted = false;
  let paying = false;

  if (!id || !token) {
    root.innerHTML = '<p class="empty">Pedido não encontrado. <a href="/">Voltar ao cardápio</a></p>';
    return;
  }

  async function refresh() {
    try {
      const r = await api(`/api/orders/${id}${q}`);
      const changed = !order || r.order.status !== order.status || r.order.paymentStatus !== order.paymentStatus || r.order.pix?.qr !== order.pix?.qr;
      order = r.order;
      payment = r.payment;
      if (changed) render();
    } catch (e) {
      if (e.status === 404) root.innerHTML = '<p class="empty">Pedido não encontrado. <a href="/">Voltar ao cardápio</a></p>';
    }
    schedule();
  }

  function schedule() {
    clearTimeout(pollTimer);
    if (!order || ['concluido', 'cancelado'].includes(order.status)) return;
    pollTimer = setTimeout(refresh, order.paymentStatus === 'pendente' ? 4000 : 15000);
  }

  const needsOnlinePayment = () => ['pix', 'card'].includes(order.paymentMethod) && order.paymentStatus !== 'aprovado' && order.status !== 'cancelado';

  function render() {
    const o = order;
    const steps = o.type === 'delivery'
      ? ['recebido', 'em_preparo', 'saiu_entrega', 'concluido']
      : ['recebido', 'em_preparo', 'pronto_retirada', 'concluido'];
    const idx = steps.indexOf(o.status);
    const steps_html = o.status === 'cancelado' ? '' : `<ol class="steps">${steps.map((s, i) => `
      <li class="${idx > i || o.status === 'concluido' ? 'done' : idx === i ? 'current' : ''}">${STATUS_LABELS[s]}</li>`).join('')}</ol>`;
    const lead = o.status === 'aguardando_pagamento'
      ? '<p class="muted" style="margin:0">A cozinha começa assim que o pagamento for confirmado.</p>'
      : o.status === 'cancelado' ? '<p class="muted" style="margin:0">Se tiver dúvida, fale com a gente pelo WhatsApp.</p>'
        : `<p class="muted" style="margin:0">Tempo estimado: <b style="color:var(--ink)">${esc(o.estimate)}</b></p>`;

    root.innerHTML = `
      <div class="order-grid">
        <div>
          <section class="panel" aria-live="polite">
            <div class="order-no">Pedido nº ${o.id}</div>
            <h1 class="big-status ${o.status === 'cancelado' ? 'cancelled' : ''}">${STATUS_LABELS[o.status]}</h1>
            ${lead}
            ${steps_html}
          </section>
          ${needsOnlinePayment() ? '<section class="panel" id="payPanel"></section>' : ''}
          ${o.paymentStatus === 'aprovado' ? `<section class="panel paid"><div class="ok-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div><div><b>Pagamento confirmado</b><div class="muted">${o.paymentMethod === 'pix' ? 'Pix' : 'Cartão'}, ${money(o.totalCents)}</div></div></section>` : ''}
          <section class="panel">
            <h2>Precisa falar com a gente?</h2>
            <p class="muted" style="margin-top:0">Mande o pedido pelo WhatsApp e a gente responde por lá.</p>
            <a class="btn whats block" id="waBtn" target="_blank" rel="noopener">Enviar pedido pelo WhatsApp</a>
          </section>
        </div>
        <section class="panel">
          <h2>Resumo</h2>
          ${o.items.map((i) => `
            <div class="bag-line">
              <div>
                <div class="name">${i.qty}× ${esc(i.name)}</div>
                ${i.addons.length ? `<div class="extra">Com ${esc(i.addons.map((a) => a.name).join(', '))}</div>` : ''}
                ${i.notes ? `<div class="extra">Obs.: ${esc(i.notes)}</div>` : ''}
              </div>
              <div class="line-price">${money(i.total_cents)}</div>
            </div>`).join('')}
          <div class="totals">
            <div><span>Subtotal</span><span>${money(o.subtotalCents)}</span></div>
            <div><span>Taxa de entrega</span><span>${o.type === 'delivery' ? money(o.deliveryFeeCents) : 'Sem taxa'}</span></div>
            <div class="total"><span>Total</span><span>${money(o.totalCents)}</span></div>
          </div>
          <div class="order-meta">
            <div><b>Pagamento:</b> ${PAY_LABELS[o.paymentMethod]}${o.changeForCents ? `, troco para ${money(o.changeForCents)}` : ''}</div>
            <div>${o.address ? `<b>Entrega em:</b> ${esc(addrText(o.address))}` : '<b>Retirada no balcão</b>'}</div>
          </div>
        </section>
      </div>`;

    document.getElementById('waBtn').href = whatsappLink();
    brickMounted = false;
    if (needsOnlinePayment()) renderPayment();
  }

  const addrText = (a) => `${a.street}, ${a.number}${a.complement ? ` - ${a.complement}` : ''} - ${a.neighborhood}, ${a.city}/${a.state}${a.reference ? ` (Ref.: ${a.reference})` : ''}`;

  function whatsappLink() {
    const o = order;
    const lines = [
      `*Pedido #${o.id}* - Papito's Burguer`,
      ...o.items.map((i) => `${i.qty}x ${i.name}${i.addons.length ? ` (+ ${i.addons.map((a) => a.name).join(', ')})` : ''}${i.notes ? ` - Obs: ${i.notes}` : ''}`),
      `Total: ${money(o.totalCents)}`,
      `Pagamento: ${PAY_LABELS[o.paymentMethod]} - ${PAYMENT_STATUS_LABELS[o.paymentStatus]}`,
      o.address ? `Entrega: ${addrText(o.address)}` : 'Retirada no local',
      `Cliente: ${o.customer.name}`,
    ];
    const phone = (window.STORE_WHATSAPP || '5563992438018').replace(/\D/g, '');
    return `https://wa.me/${phone}?text=${encodeURIComponent(lines.join('\n'))}`;
  }

  // ---------- Pagamento ----------
  function renderPayment() {
    const panel = document.getElementById('payPanel');
    const demo = !payment.live;
    const demoNote = demo ? '<div class="alert info"><b>Modo de teste.</b> O Mercado Pago ainda não foi ligado, então nada é cobrado.</div>' : '';
    const rejected = order.paymentStatus === 'recusado'
      ? `<div class="alert">Pagamento não aprovado${order.paymentDetail ? ` (${esc(order.paymentDetail)})` : ''}. Tente novamente ou use outra forma de pagamento.</div>` : '';

    if (order.paymentMethod === 'pix') {
      if (!order.pix) {
        panel.innerHTML = `<h2>Pague com Pix</h2>${demoNote}<p class="muted">Gerando seu QR Code…</p>`;
        createPix();
        return;
      }
      const qrImg = order.pix.qrBase64
        ? `<img src="data:image/png;base64,${order.pix.qrBase64}" alt="QR Code Pix">`
        : '<div class="qr-demo">QR Code de<br>demonstração</div>';
      panel.innerHTML = `
        <h2>Pague com Pix</h2>${demoNote}${rejected}
        <div class="pix-box">
          <p class="muted" style="margin:0">No app do seu banco, escolha pagar com Pix e leia o QR Code. Ou copie o código e use o Pix Copia e Cola.</p>
          ${qrImg}
          <div class="pix-code">
            <input type="text" readonly value="${esc(order.pix.qr)}" id="pixCode" aria-label="Código Pix copia e cola">
            <button class="btn" id="copyPix">Copiar</button>
          </div>
          <div class="countdown" id="countdown"></div>
          <p class="muted" style="font-size:var(--text-secondary)">Quando o pagamento cair, esta página atualiza sozinha.</p>
          ${demo ? '<button class="btn dark block" id="demoPay">Simular pagamento aprovado</button>' : ''}
        </div>`;
      document.getElementById('copyPix').onclick = async () => {
        const input = document.getElementById('pixCode');
        try { await navigator.clipboard.writeText(input.value); } catch { input.select(); document.execCommand('copy'); }
        toast('Código Pix copiado!');
      };
      startCountdown();
    } else if (order.paymentStatus === 'pendente' && order.paymentDetail) {
      // Cartão enviado e em análise antifraude: não mostra o formulário de novo para evitar cobrança dupla
      panel.innerHTML = `<h2>Pagamento em análise</h2>
        <p style="color:var(--ink-2);margin:0">O Mercado Pago está analisando seu pagamento. Isso costuma levar poucos minutos e esta página atualiza sozinha.</p>`;
      return;
    } else {
      panel.innerHTML = `
        <h2>Pague com cartão</h2>${demoNote}${rejected}
        <p style="color:var(--ink-2);margin-top:0">Total: <b style="color:var(--ink)">${money(order.totalCents)}</b>. O pagamento é feito pelo Mercado Pago. Os dados do cartão não passam pelo nosso servidor.</p>
        ${demo ? '<button class="btn dark block" id="demoPay">Simular pagamento com cartão</button>' : '<div id="cardPaymentBrick_container"></div>'}`;
      if (!demo) mountCardBrick();
    }
    const demoBtn = document.getElementById('demoPay');
    if (demoBtn) {
      demoBtn.onclick = async () => {
        demoBtn.disabled = true;
        try {
          const path = order.paymentMethod === 'pix' ? 'demo-pay' : 'card';
          const r = await api(`/api/orders/${id}/${path}${q}`, { method: 'POST', body: {} });
          order = r.order;
          render();
          schedule();
        } catch (e) { toast(e.message); demoBtn.disabled = false; }
      };
    }
  }

  async function createPix() {
    if (paying) return;
    paying = true;
    try {
      const r = await api(`/api/orders/${id}/pix${q}`, { method: 'POST', body: {} });
      order = r.order;
      render();
    } catch (e) {
      const panel = document.getElementById('payPanel');
      if (panel) panel.innerHTML = `<h2>Pague com Pix</h2><div class="alert">${esc(e.message)}</div><button class="btn block" id="retryPix">Tentar novamente</button>`;
      const b = document.getElementById('retryPix');
      if (b) b.onclick = () => { order.pix = null; renderPayment(); };
    } finally { paying = false; }
  }

  let cdTimer = null;
  function startCountdown() {
    clearInterval(cdTimer);
    const el = document.getElementById('countdown');
    const exp = new Date(order.pix.expiresAt).getTime();
    const tick = () => {
      const left = Math.max(0, exp - Date.now());
      if (!document.body.contains(el)) return clearInterval(cdTimer);
      if (!left) {
        clearInterval(cdTimer);
        el.innerHTML = 'Código expirado. <button class="link-btn" style="color:var(--ink)" id="newPix">Gerar novo código</button>';
        document.getElementById('newPix').onclick = () => { order.pix = null; renderPayment(); };
        return;
      }
      const m = Math.floor(left / 60000);
      const s = Math.floor((left % 60000) / 1000);
      el.textContent = `O código expira em ${m}:${String(s).padStart(2, '0')}`;
    };
    tick();
    cdTimer = setInterval(tick, 1000);
  }

  // Card Payment Brick do Mercado Pago: o formulário do cartão roda dentro do site,
  // mas os dados sensíveis vão direto para o Mercado Pago (tokenização).
  function loadMpSdk() {
    if (window.MercadoPago) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://sdk.mercadopago.com/js/v2';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Não foi possível carregar o pagamento. Verifique sua conexão.'));
      document.head.appendChild(s);
    });
  }

  async function mountCardBrick() {
    if (brickMounted) return;
    brickMounted = true;
    try {
      await loadMpSdk();
      const mp = new window.MercadoPago(payment.publicKey, { locale: 'pt-BR' });
      await mp.bricks().create('cardPayment', 'cardPaymentBrick_container', {
        initialization: { amount: order.totalCents / 100, payer: { email: order.customer.email || '' } },
        customization: {
          visual: { style: { theme: 'default', customVariables: { baseColor: '#2b211b' } } },
          paymentMethods: { maxInstallments: 3 },
        },
        callbacks: {
          onReady: () => {},
          onError: (err) => console.error(err),
          onSubmit: async (formData) => {
            const r = await api(`/api/orders/${id}/card${q}`, { method: 'POST', body: formData });
            order = r.order;
            render();
            schedule();
          },
        },
      });
    } catch (e) {
      const c = document.getElementById('cardPaymentBrick_container');
      if (c) c.innerHTML = `<div class="alert">${esc(e.message || 'Erro ao carregar o pagamento.')}</div>`;
    }
  }

  // Busca o WhatsApp da loja para o botão
  api('/api/menu').then((m) => { window.STORE_WHATSAPP = m.settings.whatsapp; const b = document.getElementById('waBtn'); if (b && order) b.href = whatsappLink(); }).catch(() => {});
  refresh();
})();
