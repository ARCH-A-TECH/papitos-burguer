/* Cardápio + carrinho + checkout */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const CART_KEY = 'papitos_cart_v1';
  const CUSTOMER_KEY = 'papitos_customer_v1';

  const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem storage */ } } };

  let MENU = null;
  let products = new Map();
  let addons = new Map();
  let cart = store.get(CART_KEY, []);
  let address = null; // endereço vindo do CEP

  // ---------- Carregamento ----------
  async function load() {
    try {
      MENU = await api('/api/menu');
    } catch (e) {
      $('#menu').innerHTML = `<p class="empty">Não foi possível carregar o cardápio. <a href="">Tentar novamente</a></p>`;
      return;
    }
    products = new Map(MENU.categories.flatMap((c) => c.products).map((p) => [p.id, p]));
    addons = new Map(MENU.addons.map((a) => [a.id, a]));
    // remove itens que saíram do cardápio
    cart = cart.filter((i) => products.has(i.productId)).map((i) => ({ ...i, addonIds: i.addonIds.filter((id) => addons.has(id)) }));
    saveCart();
    renderHeader();
    renderMenu();
  }

  function renderHeader() {
    const s = MENU.settings;
    document.querySelectorAll('[data-store-name]').forEach((el) => { el.textContent = s.storeName; });
    const pill = $('#statusPill');
    pill.textContent = s.isOpen ? 'Aberto agora' : 'Fechado';
    pill.classList.toggle('closed', !s.isOpen);
    const closed = $('#closedAlert');
    closed.classList.toggle('hidden', s.isOpen);
    closed.textContent = `Estamos fechados no momento. ${s.hoursText ? `Horário: ${s.hoursText}.` : ''} Você pode ver o cardápio, mas os pedidos estão pausados.`;

    const chips = [];
    if (s.deliveryEnabled) chips.push(`<span class="chip">🛵 Entrega <b>${esc(s.deliveryEstimate)}</b> • taxa <b>${s.deliveryFeeCents ? money(s.deliveryFeeCents) : 'grátis'}</b></span>`);
    if (s.pickupEnabled) chips.push(`<span class="chip">🏃 Retirada <b>${esc(s.pickupEstimate)}</b></span>`);
    if (s.hoursText) chips.push(`<span class="chip">🕒 <b>${esc(s.hoursText)}</b></span>`);
    if (s.minOrderCents) chips.push(`<span class="chip">Pedido mínimo <b>${money(s.minOrderCents)}</b></span>`);
    $('#infoStrip').innerHTML = chips.join('');

    const wa = `https://wa.me/${s.whatsapp.replace(/\D/g, '')}`;
    $('#footWhats').href = wa;
    $('#footWhats').textContent = `WhatsApp ${formatPhone(s.whatsapp)}`;
    $('#footInsta').href = `https://instagram.com/${encodeURIComponent(s.instagram)}`;
    $('#footInsta').textContent = `@${s.instagram}`;
    $('#footInsta').classList.toggle('hidden', !s.instagram);

    const featured = [...products.values()].find((p) => p.name.toLowerCase() === 'x-papitos') || [...products.values()].find((p) => p.featured);
    if (featured) {
      $('#heroPrice').textContent = money(featured.priceCents);
      $('#heroFeatured').onclick = () => openProduct(featured.id);
    } else {
      $('#heroFeatured').classList.add('hidden');
    }
  }

  const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

  function renderMenu() {
    const cats = MENU.categories;
    $('#catNav').innerHTML = cats.map((c, i) => `<a href="#cat-${slug(c.name)}" class="${i === 0 ? 'active' : ''}">${esc(c.name)}</a>`).join('')
      + (MENU.addons.length ? '<a href="#cat-adicionais">Adicionais</a>' : '');

    $('#menu').innerHTML = cats.map((c) => `
      <section id="cat-${slug(c.name)}">
        <h2>${esc(c.name)}</h2>
        <div class="grid">${c.products.map(productCard).join('')}</div>
      </section>`).join('')
      + (MENU.addons.length ? `
      <section id="cat-adicionais">
        <h2>Adicionais</h2>
        <p class="addons-info">Turbine seu lanche! Escolha os adicionais ao clicar em qualquer lanche.</p>
        <div class="addons-list">${MENU.addons.map((a) => `<div><span>${esc(a.name)}</span><b class="price" style="font-size:16px">+ ${money(a.priceCents)}</b></div>`).join('')}</div>
      </section>` : '');

    $('#menu').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-product]');
      if (btn) openProduct(Number(btn.dataset.product));
    });
    setupScrollSpy();
  }

  function productCard(p) {
    const img = p.image
      ? `<img class="thumb" src="${esc(p.image)}" alt="" loading="lazy" width="108" height="108">`
      : `<div class="thumb placeholder">${BURGER_SVG}</div>`;
    return `
      <button class="product ${p.featured ? 'featured' : ''}" data-product="${p.id}">
        <div class="body">
          ${p.featured ? '<span class="badge">Especial da casa</span>' : ''}
          <h3>${esc(p.name)}</h3>
          <p>${esc(p.description)}</p>
          <div class="price-row"><span class="price">${money(p.priceCents)}</span><span class="add-dot" aria-hidden="true">+</span></div>
        </div>
        ${img}
      </button>`;
  }

  function setupScrollSpy() {
    const links = [...document.querySelectorAll('#catNav a')];
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        links.forEach((l) => l.classList.toggle('active', l.getAttribute('href') === `#${en.target.id}`));
        const active = links.find((l) => l.classList.contains('active'));
        active?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      });
    }, { rootMargin: '-140px 0px -60% 0px' });
    document.querySelectorAll('#menu section').forEach((s) => obs.observe(s));
  }

  // ---------- Modal do produto ----------
  const pd = { id: null, qty: 1 };
  function openProduct(id) {
    const p = products.get(id);
    if (!p) return;
    pd.id = id;
    pd.qty = 1;
    const addonHtml = p.acceptsAddons && MENU.addons.length ? `
      <div class="section-title">Adicionais <small>opcional</small></div>
      ${MENU.addons.map((a) => `
        <label class="check-row"><input type="checkbox" name="addon" value="${a.id}">
          <span class="grow">${esc(a.name)}</span><span class="muted">+ ${money(a.priceCents)}</span></label>`).join('')}` : '';
    $('#productBody').innerHTML = `
      ${p.image ? `<img class="modal-photo" src="${esc(p.image)}" alt="">` : ''}
      <h3 id="pdName">${esc(p.name)}</h3>
      <p class="desc">${esc(p.description)}</p>
      <div class="price">${money(p.priceCents)}</div>
      ${addonHtml}
      <label class="field" style="margin-top:16px"><span>Alguma observação?</span>
        <textarea name="itemNotes" maxlength="200" placeholder="Ex.: sem tomate, ponto da carne…"></textarea></label>`;
    updateProductTotal();
    $('#productDialog').showModal();
  }

  function selectedAddons() {
    return [...document.querySelectorAll('#productBody input[name=addon]:checked')].map((i) => Number(i.value));
  }
  function updateProductTotal() {
    const p = products.get(pd.id);
    const unit = p.priceCents + selectedAddons().reduce((s, id) => s + addons.get(id).priceCents, 0);
    $('#pdQty').textContent = pd.qty;
    $('#pdAdd').textContent = `Adicionar • ${money(unit * pd.qty)}`;
  }
  $('#productBody').addEventListener('change', updateProductTotal);
  document.querySelectorAll('[data-qty]').forEach((b) => b.addEventListener('click', () => {
    pd.qty = Math.min(20, Math.max(1, pd.qty + Number(b.dataset.qty)));
    updateProductTotal();
  }));
  $('#productForm').addEventListener('submit', (e) => {
    if (e.submitter?.value === 'cancel') return;
    const addonIds = selectedAddons().sort((a, b) => a - b);
    const notes = $('#productBody textarea').value.trim();
    const same = cart.find((i) => i.productId === pd.id && i.notes === notes && i.addonIds.join() === addonIds.join());
    if (same) same.qty = Math.min(20, same.qty + pd.qty);
    else cart.push({ key: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), productId: pd.id, qty: pd.qty, addonIds, notes });
    saveCart();
    toast(`${products.get(pd.id).name} adicionado!`);
  });

  // ---------- Carrinho ----------
  const unitPrice = (i) => products.get(i.productId).priceCents + i.addonIds.reduce((s, id) => s + (addons.get(id)?.priceCents || 0), 0);
  const subtotal = () => cart.reduce((s, i) => s + unitPrice(i) * i.qty, 0);
  const itemCount = () => cart.reduce((s, i) => s + i.qty, 0);

  function saveCart() {
    store.set(CART_KEY, cart);
    const n = itemCount();
    $('#cartCount').textContent = n;
    $('#cartBar').classList.toggle('hidden', n === 0);
    $('#cartBarCount').textContent = n;
    if (MENU) $('#cartBarTotal').textContent = money(subtotal());
    if ($('#cartDialog').open) renderCart();
  }

  function renderCart() {
    if (!cart.length) {
      $('#cartItems').innerHTML = '<p class="empty">Seu carrinho está vazio.<br>Escolha um lanche delicioso! 🍔</p>';
      $('#cartTotals').innerHTML = '';
      $('#cartNext').disabled = true;
      return;
    }
    $('#cartNext').disabled = false;
    $('#cartItems').innerHTML = cart.map((i) => {
      const p = products.get(i.productId);
      const extras = i.addonIds.map((id) => addons.get(id)?.name).filter(Boolean);
      return `
        <div class="cart-item" data-key="${i.key}">
          <div class="grow">
            <div class="name">${esc(p.name)}</div>
            ${extras.length ? `<div class="extra">+ ${esc(extras.join(', '))}</div>` : ''}
            ${i.notes ? `<div class="extra">Obs.: ${esc(i.notes)}</div>` : ''}
            <div class="price" style="font-size:18px">${money(unitPrice(i) * i.qty)}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
            <div class="qty"><button data-act="dec" aria-label="Diminuir">−</button><span>${i.qty}</span><button data-act="inc" aria-label="Aumentar">+</button></div>
            <button class="link-btn" data-act="del">Remover</button>
          </div>
        </div>`;
    }).join('');
    const s = MENU.settings;
    $('#cartTotals').innerHTML = `
      <div><span>Subtotal</span><span>${money(subtotal())}</span></div>
      ${s.minOrderCents && subtotal() < s.minOrderCents ? `<div class="hint error">Pedido mínimo: ${money(s.minOrderCents)}</div>` : ''}`;
  }

  $('#cartItems').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const item = cart.find((i) => i.key === btn.closest('[data-key]').dataset.key);
    if (btn.dataset.act === 'inc') item.qty = Math.min(20, item.qty + 1);
    if (btn.dataset.act === 'dec') item.qty -= 1;
    if (btn.dataset.act === 'del' || item.qty < 1) cart = cart.filter((i) => i !== item);
    saveCart();
  });

  function openCart() {
    if (!MENU) return;
    showStep('cart');
    renderCart();
    $('#cartDialog').showModal();
  }
  $('#openCart').addEventListener('click', openCart);
  $('#cartBar').addEventListener('click', openCart);
  $('#cartDialog [data-close]').addEventListener('click', () => $('#cartDialog').close());

  let step = 'cart';
  function showStep(s) {
    step = s;
    $('#cartStep').classList.toggle('hidden', s !== 'cart');
    $('#checkoutForm').classList.toggle('hidden', s !== 'checkout');
    $('#cartBack').classList.toggle('hidden', s !== 'checkout');
    $('#cartTitle').textContent = s === 'cart' ? 'Seu pedido' : 'Finalizar pedido';
    $('#cartNext').textContent = s === 'cart' ? 'Continuar' : 'Fazer pedido';
    $('#cartDialog .modal-body').scrollTop = 0;
  }
  $('#cartBack').addEventListener('click', () => { showStep('cart'); renderCart(); });

  $('#cartNext').addEventListener('click', () => {
    if (step === 'cart') {
      const s = MENU.settings;
      if (!s.isOpen) { toast('A loja está fechada no momento.'); return; }
      if (s.minOrderCents && subtotal() < s.minOrderCents) { toast(`Pedido mínimo: ${money(s.minOrderCents)}`); return; }
      prepareCheckout();
      showStep('checkout');
    } else {
      submitOrder();
    }
  });

  // ---------- Checkout ----------
  const form = $('#checkoutForm');

  function prepareCheckout() {
    const s = MENU.settings;
    const typeInputs = form.querySelectorAll('input[name=type]');
    typeInputs[0].disabled = !s.deliveryEnabled;
    typeInputs[1].disabled = !s.pickupEnabled;
    typeInputs[0].closest('label').classList.toggle('hidden', !s.deliveryEnabled);
    typeInputs[1].closest('label').classList.toggle('hidden', !s.pickupEnabled);
    if (!s.deliveryEnabled) typeInputs[1].checked = true;
    if (!s.pickupEnabled) typeInputs[0].checked = true;
    $('#deliveryInfo').textContent = `${s.deliveryEstimate} • ${s.deliveryFeeCents ? money(s.deliveryFeeCents) : 'grátis'}`;
    $('#pickupInfo').textContent = `${s.pickupEstimate} • sem taxa`;
    $('#pickupBox').innerHTML = `<b>Retirada no local</b><br>${s.pickupAddress ? esc(s.pickupAddress) : 'Avisaremos pelo WhatsApp quando o pedido estiver pronto.'}`;

    const methods = [['pix', s.payPix], ['card', s.payCard], ['cash', s.payCashOnDelivery], ['card_on_delivery', s.payCardOnDelivery]].filter(([, on]) => on);
    const current = form.querySelector('input[name=pay]:checked')?.value;
    $('#payOptions').innerHTML = methods.map(([m], i) => `
      <label class="check-row"><input type="radio" name="pay" value="${m}" ${(current ? current === m : i === 0) ? 'checked' : ''}>
        <span class="grow">${PAY_LABELS[m]}</span>
        ${m === 'pix' ? '<span class="muted">aprovação na hora</span>' : ''}</label>`).join('');

    // dados salvos da última compra
    const saved = store.get(CUSTOMER_KEY, null);
    if (saved && !form.name.value) {
      ['name', 'phone', 'email'].forEach((k) => { form[k].value = saved[k] || ''; });
      if (saved.address) {
        address = saved.address;
        form.cep.value = formatCep(saved.address.cep);
        form.street.value = saved.address.street || '';
        form.number.value = saved.address.number || '';
        form.complement.value = saved.address.complement || '';
        form.neighborhood.value = saved.address.neighborhood || '';
        form.reference.value = saved.address.reference || '';
        form.cityUf.value = `${saved.address.city} / ${saved.address.state}`;
      }
    }
    syncCheckout();
  }

  function syncCheckout() {
    const s = MENU.settings;
    const type = form.querySelector('input[name=type]:checked')?.value || 'delivery';
    const pay = form.querySelector('input[name=pay]:checked')?.value;
    $('#addressBox').classList.toggle('hidden', type !== 'delivery');
    $('#pickupBox').classList.toggle('hidden', type !== 'pickup');
    $('#changeBox').classList.toggle('hidden', pay !== 'cash');
    const online = pay === 'pix' || pay === 'card';
    $('#emailReq').textContent = online ? '(obrigatório para pagar online)' : '(opcional)';
    const fee = type === 'delivery' ? s.deliveryFeeCents : 0;
    $('#checkoutTotals').innerHTML = `
      <div><span>Subtotal</span><span>${money(subtotal())}</span></div>
      <div><span>Taxa de entrega</span><span>${type === 'delivery' ? (fee ? money(fee) : 'Grátis') : '—'}</span></div>
      <div class="total"><span>Total</span><span>${money(subtotal() + fee)}</span></div>`;
  }
  form.addEventListener('change', syncCheckout);

  // CEP
  const formatCep = (v) => String(v || '').replace(/\D/g, '').slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');
  form.cep.addEventListener('input', () => {
    form.cep.value = formatCep(form.cep.value);
    if (form.cep.value.length === 9) lookupCep();
  });
  $('#cepBtn').addEventListener('click', lookupCep);

  // Consulta o CEP no ViaCEP; se estiver fora do ar, tenta a BrasilAPI.
  // Retorna null se o CEP não existe e lança erro se nenhuma API respondeu.
  async function fetchCep(cep) {
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      if (r.ok) {
        const d = await r.json();
        return d.erro ? null : { street: d.logradouro, neighborhood: d.bairro, city: d.localidade, state: d.uf };
      }
    } catch { /* tenta a próxima */ }
    const r = await fetch(`https://brasilapi.com.br/api/cep/v2/${cep}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('cep indisponível');
    const d = await r.json();
    return { street: d.street, neighborhood: d.neighborhood, city: d.city, state: d.state };
  }

  let cepSeq = 0;
  async function lookupCep() {
    const cep = form.cep.value.replace(/\D/g, '');
    const hint = $('#cepHint');
    hint.className = 'hint';
    if (cep.length !== 8) { hint.textContent = 'Digite os 8 números do CEP.'; hint.classList.add('error'); return; }
    hint.textContent = 'Buscando endereço…';
    const seq = ++cepSeq;
    let data = null;
    form.cityUf.readOnly = true;
    try {
      data = await fetchCep(cep);
    } catch {
      if (seq !== cepSeq) return;
      // Serviço de CEP fora do ar: libera o preenchimento manual
      address = { cep, city: '', state: '', manual: true };
      form.cityUf.readOnly = false;
      form.cityUf.placeholder = 'Ex.: Palmas / TO';
      hint.textContent = 'Não conseguimos consultar o CEP agora. Preencha o endereço manualmente.';
      hint.classList.add('error');
      form.street.focus();
      return;
    }
    if (seq !== cepSeq) return;
    if (!data) {
      address = null;
      hint.textContent = 'CEP não encontrado. Confira os números.';
      hint.classList.add('error');
      return;
    }
    address = { cep, ...data };
    if (data.street) form.street.value = data.street;
    if (data.neighborhood) form.neighborhood.value = data.neighborhood;
    form.cityUf.value = `${data.city} / ${data.state}`;
    const cities = MENU.settings.deliveryCities.split(',').map((c) => c.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')).filter(Boolean);
    const cityNorm = data.city.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (cities.length && !cities.includes(cityNorm)) {
      hint.textContent = `Ainda não entregamos em ${data.city}. Você pode escolher retirar no local.`;
      hint.classList.add('error');
    } else {
      hint.textContent = `✓ Entregamos em ${data.city}! Agora informe o número.`;
      hint.classList.add('ok');
      (data.street ? form.number : form.street).focus();
    }
  }

  // Máscara simples de telefone
  form.phone.addEventListener('input', () => {
    const d = form.phone.value.replace(/\D/g, '').slice(0, 11);
    form.phone.value = d.length > 10 ? d.replace(/^(\d{2})(\d{5})(\d{0,4}).*/, '($1) $2-$3')
      : d.length > 6 ? d.replace(/^(\d{2})(\d{4})(\d{0,4}).*/, '($1) $2-$3')
        : d.length > 2 ? d.replace(/^(\d{2})(\d*)/, '($1) $2') : d;
  });

  function showError(msg) {
    const el = $('#checkoutError');
    el.textContent = msg;
    el.classList.remove('hidden');
    $('#cartDialog .modal-body').scrollTop = 0;
  }

  let submitting = false;
  async function submitOrder() {
    if (submitting) return;
    $('#checkoutError').classList.add('hidden');
    const type = form.querySelector('input[name=type]:checked')?.value;
    const pay = form.querySelector('input[name=pay]:checked')?.value;
    if (!pay) return showError('Escolha a forma de pagamento.');
    if (type === 'delivery') {
      if (!address || address.cep !== form.cep.value.replace(/\D/g, '')) return showError('Informe um CEP válido e clique em Buscar.');
      if (!form.street.value.trim() || !form.number.value.trim() || !form.neighborhood.value.trim()) return showError('Preencha rua, número e bairro.');
      if (address.manual) {
        const [city, uf = ''] = form.cityUf.value.split(/[\/-]/).map((x) => x.trim());
        if (!city) return showError('Informe a cidade.');
        Object.assign(address, { city, state: uf.slice(0, 2).toUpperCase() });
      }
    }
    const body = {
      type,
      paymentMethod: pay,
      customer: { name: form.name.value, phone: form.phone.value, email: form.email.value },
      address: type === 'delivery' ? {
        cep: address.cep, street: form.street.value, number: form.number.value, complement: form.complement.value,
        neighborhood: form.neighborhood.value, city: address.city, state: address.state, reference: form.reference.value,
      } : null,
      items: cart.map((i) => ({ productId: i.productId, qty: i.qty, addonIds: i.addonIds, notes: i.notes })),
      notes: form.notes.value,
      changeFor: pay === 'cash' ? form.changeFor.value : null,
    };
    submitting = true;
    const btn = $('#cartNext');
    btn.disabled = true;
    btn.textContent = 'Enviando pedido…';
    try {
      const r = await api('/api/orders', { method: 'POST', body });
      store.set(CUSTOMER_KEY, { name: body.customer.name, phone: body.customer.phone, email: body.customer.email, address: body.address || store.get(CUSTOMER_KEY, {})?.address });
      const recent = store.get('papitos_orders', []);
      store.set('papitos_orders', [{ id: r.id, token: r.token, at: Date.now() }, ...recent].slice(0, 10));
      cart = [];
      saveCart();
      location.href = `/pedido?id=${r.id}&t=${encodeURIComponent(r.token)}`;
    } catch (e) {
      showError(e.message);
      btn.disabled = false;
      btn.textContent = 'Fazer pedido';
    } finally {
      submitting = false;
    }
  }

  $('#year').textContent = new Date().getFullYear();
  saveCart();
  load();
})();
