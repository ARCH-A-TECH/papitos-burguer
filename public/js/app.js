/* Cardápio + sacola + fechamento do pedido */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const CART_KEY = 'papitos_cart_v1';
  const CUSTOMER_KEY = 'papitos_customer_v1';
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem storage */ } },
  };
  const icon = (id) => `<svg aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-');

  let MENU = null;
  let products = new Map();
  let addons = new Map();
  let cart = store.get(CART_KEY, []);
  let address = null; // endereço confirmado pelo CEP

  // ---------- carregamento ----------
  async function load() {
    try {
      MENU = await api('/api/menu');
    } catch {
      $('#menu').innerHTML = '<p class="empty"><b>Não foi possível carregar o cardápio.</b>Confira sua internet e <a href="">recarregue a página</a>.</p>';
      return;
    }
    products = new Map(MENU.categories.flatMap((c) => c.products).map((p) => [p.id, p]));
    addons = new Map(MENU.addons.map((a) => [a.id, a]));
    cart = cart.filter((i) => products.has(i.productId)).map((i) => ({ ...i, addonIds: i.addonIds.filter((id) => addons.has(id)) }));
    saveCart();
    renderHeader();
    renderMenu();
  }

  function renderHeader() {
    const s = MENU.settings;
    $$('[data-store-name]').forEach((el) => { el.textContent = s.storeName; });
    const st = $('#storeStatus');
    st.textContent = s.isOpen ? 'Aberto agora' : 'Fechado agora';
    st.classList.toggle('closed', !s.isOpen);
    const note = $('#closedNote');
    note.classList.toggle('hidden', s.isOpen);
    note.textContent = `Estamos fechados. ${s.hoursText ? `Horário: ${s.hoursText}. ` : ''}Você pode montar a sacola, mas os pedidos voltam quando abrirmos.`;

    const service = [];
    if (s.deliveryEnabled) service.push(`<li>${icon('moto')}<span>Entrega em <b>${esc(s.deliveryEstimate)}</b>, taxa de <b>${s.deliveryFeeCents ? money(s.deliveryFeeCents) : 'R$ 0,00'}</b></span></li>`);
    if (s.pickupEnabled) service.push(`<li>${icon('store')}<span>Retirada em <b>${esc(s.pickupEstimate)}</b>, sem taxa</span></li>`);
    if (s.hoursText) service.push(`<li>${icon('clock')}<span>${esc(s.hoursText)}</span></li>`);
    if (s.minOrderCents) service.push(`<li>${icon('bag')}<span>Pedido mínimo de <b>${money(s.minOrderCents)}</b></span></li>`);
    $('#serviceList').innerHTML = service.join('');

    $('#footWhats').href = `https://wa.me/${s.whatsapp.replace(/\D/g, '')}`;
    $('#footWhats').textContent = `WhatsApp ${formatPhone(s.whatsapp)}`;
    $('#footInsta').href = `https://instagram.com/${encodeURIComponent(s.instagram)}`;
    $('#footInsta').textContent = `Instagram @${s.instagram}`;
    $('#footInsta').classList.toggle('hidden', !s.instagram);

    const all = [...products.values()];
    const featured = all.find((p) => norm(p.name) === 'x-papitos') || all.find((p) => p.featured && p.image) || all.find((p) => p.featured);
    if (featured) {
      $('#heroPrice').textContent = money(featured.priceCents);
      $('#heroFeatured').textContent = `Pedir o ${featured.name}`;
      $('#heroFeatured').onclick = () => openProduct(featured.id);
    } else {
      $('#heroFeatured').classList.add('hidden');
    }
  }

  function renderMenu() {
    const cats = MENU.categories;
    $('#catNav').innerHTML = cats.map((c, i) => `<a href="#cat-${slug(c.name)}" class="${i === 0 ? 'active' : ''}">${esc(c.name)}</a>`).join('')
      + (MENU.addons.length ? '<a href="#cat-adicionais">Adicionais</a>' : '');

    $('#menu').innerHTML = cats.map((c) => `
      <section class="menu-section" id="cat-${slug(c.name)}" aria-labelledby="h-${slug(c.name)}">
        <h2 id="h-${slug(c.name)}">${esc(c.name)}</h2>
        <ul class="items">${c.products.map((p) => `<li>${itemRow(p)}</li>`).join('')}</ul>
      </section>`).join('')
      + (MENU.addons.length ? `
      <section class="menu-section" id="cat-adicionais" aria-labelledby="h-adicionais">
        <h2 id="h-adicionais">Adicionais</h2>
        <p class="section-note">Escolha ao abrir qualquer lanche.</p>
        <ul class="addon-list">${MENU.addons.map((a) => `<li><span>${esc(a.name)}</span><span class="leader" aria-hidden="true"></span><span class="item-price">+ ${money(a.priceCents)}</span></li>`).join('')}</ul>
      </section>` : '');
    setupScrollSpy();
  }

  function itemRow(p) {
    return `
      <button class="item" data-product="${p.id}" aria-label="${esc(p.name)}, ${money(p.priceCents)}. Adicionar à sacola">
        <span>
          <span class="item-head"><span class="item-name">${esc(p.name)}</span><span class="leader" aria-hidden="true"></span><span class="item-price">${money(p.priceCents)}</span></span>
          ${p.description ? `<span class="item-desc" style="display:block">${esc(p.description)}</span>` : ''}
        </span>
        <span class="item-side">
          ${p.image ? `<img class="item-photo" src="${esc(p.image)}" alt="" loading="lazy" width="92" height="92">` : ''}
          <span class="add-mark">${icon('plus')}</span>
        </span>
      </button>`;
  }

  $('#menu').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-product]');
    if (btn) openProduct(Number(btn.dataset.product));
  });

  function setupScrollSpy() {
    const links = $$('#catNav a');
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        links.forEach((l) => l.classList.toggle('active', l.getAttribute('href') === `#${en.target.id}`));
        const active = links.find((l) => l.classList.contains('active'));
        const nav = $('#catNav');
        if (active) nav.scrollTo({ left: active.offsetLeft - nav.clientWidth / 2 + active.clientWidth / 2, behavior: 'smooth' });
      });
    }, { rootMargin: '-130px 0px -60% 0px' });
    $$('#menu section').forEach((s) => obs.observe(s));
  }

  // ---------- lanche ----------
  const pd = { id: null, qty: 1 };
  function openProduct(id) {
    const p = products.get(id);
    if (!p) return;
    pd.id = id;
    pd.qty = 1;
    const addonHtml = p.acceptsAddons && MENU.addons.length ? `
      <div class="group-title"><span>Adicionais</span><small>opcional</small></div>
      ${MENU.addons.map((a) => `
        <label class="choice"><input type="checkbox" name="addon" value="${a.id}">
          <span class="grow">${esc(a.name)}</span><span class="note">+ ${money(a.priceCents)}</span></label>`).join('')}` : '';
    $('#productBody').innerHTML = `
      ${p.image ? `<img class="product-photo" src="${esc(p.image)}" alt="">` : ''}
      <h3 class="product-title" id="pdName">${esc(p.name)}</h3>
      ${p.description ? `<p class="product-desc">${esc(p.description)}</p>` : ''}
      <div class="product-price">${money(p.priceCents)}</div>
      ${addonHtml}
      <label class="field" style="margin-top:22px"><span>Alguma observação? <small>(opcional)</small></span>
        <textarea name="itemNotes" maxlength="200" placeholder="Ex.: sem tomate, carne bem passada"></textarea></label>`;
    updateProductTotal();
    $('#productDialog').showModal();
    $('#productDialog .modal-body').scrollTop = 0;
  }

  const selectedAddons = () => $$('#productBody input[name=addon]:checked').map((i) => Number(i.value));
  function updateProductTotal() {
    const p = products.get(pd.id);
    const unit = p.priceCents + selectedAddons().reduce((s, id) => s + addons.get(id).priceCents, 0);
    $('#pdQty').textContent = pd.qty;
    $('#pdTotal').textContent = money(unit * pd.qty);
  }
  $('#productBody').addEventListener('change', updateProductTotal);
  $$('[data-qty]').forEach((b) => b.addEventListener('click', () => {
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
    toast(`${products.get(pd.id).name} na sacola`);
  });

  // ---------- sacola ----------
  const unitPrice = (i) => products.get(i.productId).priceCents + i.addonIds.reduce((s, id) => s + (addons.get(id)?.priceCents || 0), 0);
  const subtotal = () => cart.reduce((s, i) => s + unitPrice(i) * i.qty, 0);
  const itemCount = () => cart.reduce((s, i) => s + i.qty, 0);

  function saveCart() {
    store.set(CART_KEY, cart);
    const n = itemCount();
    $('#bagCount').textContent = n;
    $('#bagBar').classList.toggle('hidden', n === 0);
    document.body.classList.toggle('has-bag', n > 0);
    $('#bagBarCount').textContent = n;
    if (MENU) {
      $('#bagBarTotal').textContent = money(subtotal());
      renderBag();
    }
  }

  function renderBag() {
    const s = MENU.settings;
    const lines = cart.length ? cart.map((i) => {
      const p = products.get(i.productId);
      const extras = i.addonIds.map((id) => addons.get(id)?.name).filter(Boolean);
      return `
        <div class="bag-line" data-key="${i.key}">
          <div>
            <div class="name">${esc(p.name)}</div>
            ${extras.length ? `<div class="extra">Com ${esc(extras.join(', '))}</div>` : ''}
            ${i.notes ? `<div class="extra">Obs.: ${esc(i.notes)}</div>` : ''}
          </div>
          <div class="line-price">${money(unitPrice(i) * i.qty)}</div>
          <div class="controls">
            <div class="qty">
              <button data-act="dec" aria-label="Tirar um ${esc(p.name)}">${icon('minus')}</button>
              <output>${i.qty}</output>
              <button data-act="inc" aria-label="Pôr mais um ${esc(p.name)}">${icon('plus')}</button>
            </div>
            <button class="link-btn" data-act="del">Remover</button>
          </div>
        </div>`;
    }).join('') : '<p class="empty"><b>Sua sacola está vazia.</b>Toque em um lanche do cardápio para começar.</p>';
    const totals = cart.length ? `
      <div class="total"><span>Subtotal</span><span>${money(subtotal())}</span></div>
      ${s.minOrderCents && subtotal() < s.minOrderCents ? `<p class="min-note">Faltam ${money(s.minOrderCents - subtotal())} para o pedido mínimo.</p>` : ''}` : '';
    $$('[data-bag-lines]').forEach((el) => { el.innerHTML = lines; });
    $$('[data-bag-totals]').forEach((el) => { el.innerHTML = totals; });
    const checkoutBtn = $('[data-bag-checkout]');
    checkoutBtn.innerHTML = cart.length ? `<span>Fechar pedido</span><span>${money(subtotal())}</span>` : '<span>Escolha um lanche</span>';
    if (step === 'bag') updateFooter();
    if (step === 'checkout') syncCheckout();
  }

  function onBagClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const item = cart.find((i) => i.key === btn.closest('[data-key]').dataset.key);
    if (!item) return;
    if (btn.dataset.act === 'inc') item.qty = Math.min(20, item.qty + 1);
    if (btn.dataset.act === 'dec') item.qty -= 1;
    if (btn.dataset.act === 'del' || item.qty < 1) cart = cart.filter((i) => i !== item);
    saveCart();
  }
  $$('[data-bag-lines]').forEach((el) => el.addEventListener('click', onBagClick));

  function openBag(atCheckout = false) {
    if (!MENU) return;
    showStep(atCheckout && cart.length ? 'checkout' : 'bag');
    $('#bagDialog').showModal();
  }
  $('#openBag').addEventListener('click', () => openBag());
  $('#bagBar').addEventListener('click', () => openBag());
  $('[data-bag-checkout]').addEventListener('click', () => {
    if (!cart.length) { document.getElementById('cardapio').scrollIntoView({ behavior: 'smooth' }); return; }
    if (!canStartCheckout()) return;
    openBag(true);
  });
  $('#bagDialog [data-close]').addEventListener('click', () => $('#bagDialog').close());
  $('#bagBack').addEventListener('click', () => showStep('bag'));

  let step = 'bag';
  function showStep(s) {
    step = s;
    if (s === 'checkout') prepareCheckout();
    $('#bagStep').classList.toggle('hidden', s !== 'bag');
    $('#checkoutForm').classList.toggle('hidden', s !== 'checkout');
    $('#bagBack').classList.toggle('hidden', s !== 'checkout');
    $('#bagTitle').textContent = s === 'bag' ? 'Sua sacola' : 'Entrega e pagamento';
    $('#bagDialog .modal-body').scrollTop = 0;
    updateFooter();
  }

  function orderTotal() {
    const type = $('#checkoutForm input[name=type]:checked')?.value || 'delivery';
    return subtotal() + (type === 'delivery' ? MENU.settings.deliveryFeeCents : 0);
  }
  function updateFooter() {
    if (step === 'bag') {
      $('#bagNextLabel').textContent = cart.length ? 'Escolher entrega e pagamento' : 'Ver cardápio';
      $('#bagNextTotal').textContent = cart.length ? money(subtotal()) : '';
    } else {
      $('#bagNextLabel').textContent = submitting ? 'Enviando pedido…' : 'Fazer pedido';
      $('#bagNextTotal').textContent = money(orderTotal());
    }
  }

  function canStartCheckout() {
    const s = MENU.settings;
    if (!s.isOpen) { toast('Estamos fechados agora. Volte no horário de funcionamento.'); return false; }
    if (s.minOrderCents && subtotal() < s.minOrderCents) { toast(`O pedido mínimo é ${money(s.minOrderCents)}.`); return false; }
    return true;
  }

  $('#bagNext').addEventListener('click', () => {
    if (step === 'bag') {
      if (!cart.length) { $('#bagDialog').close(); document.getElementById('cardapio').scrollIntoView({ behavior: 'smooth' }); return; }
      if (canStartCheckout()) showStep('checkout');
    } else {
      submitOrder();
    }
  });

  // ---------- fechamento ----------
  const form = $('#checkoutForm');
  const touched = new Set();
  let focusingFromSubmit = false; // o foco vindo do botão não deve apagar o erro que acabamos de mostrar

  function prepareCheckout() {
    const s = MENU.settings;
    const [deliv, pick] = $$('input[name=type]', form);
    deliv.closest('label').classList.toggle('hidden', !s.deliveryEnabled);
    pick.closest('label').classList.toggle('hidden', !s.pickupEnabled);
    if (!s.deliveryEnabled) pick.checked = true;
    if (!s.pickupEnabled) deliv.checked = true;
    $('#deliveryInfo').textContent = `${s.deliveryEstimate}, ${s.deliveryFeeCents ? money(s.deliveryFeeCents) : 'sem taxa'}`;
    $('#pickupInfo').textContent = `${s.pickupEstimate}, sem taxa`;
    $('#pickupBox').innerHTML = `<b>Retirada no balcão.</b> ${s.pickupAddress ? esc(s.pickupAddress) : 'Avisamos pelo WhatsApp quando estiver pronto.'}`;

    const methods = [['pix', s.payPix, 'Aprovação na hora'], ['card', s.payCard, 'Crédito'], ['cash', s.payCashOnDelivery, ''], ['card_on_delivery', s.payCardOnDelivery, '']].filter(([, on]) => on);
    const current = form.querySelector('input[name=pay]:checked')?.value;
    $('#payOptions').innerHTML = methods.map(([m, , note], i) => `
      <label class="choice"><input type="radio" name="pay" value="${m}" ${(current ? current === m : i === 0) ? 'checked' : ''}>
        <span class="grow">${PAY_LABELS[m]}</span>${note ? `<span class="note">${note}</span>` : ''}</label>`).join('');

    const saved = store.get(CUSTOMER_KEY, null);
    if (saved && !form.name.value) {
      ['name', 'phone', 'email'].forEach((k) => { form[k].value = saved[k] || ''; });
      if (saved.address) {
        address = saved.address;
        form.cep.value = formatCep(saved.address.cep);
        ['street', 'number', 'complement', 'neighborhood', 'reference'].forEach((k) => { form[k].value = saved.address[k] || ''; });
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
    $('#emailReq').textContent = pay === 'pix' || pay === 'card' ? '(para receber o comprovante)' : '(opcional)';
    const fee = type === 'delivery' ? s.deliveryFeeCents : 0;
    $('#checkoutTotals').innerHTML = `
      <div><span>Subtotal</span><span>${money(subtotal())}</span></div>
      <div><span>Taxa de entrega</span><span>${type === 'delivery' ? money(fee) : 'Sem taxa'}</span></div>
      <div class="total"><span>Total</span><span>${money(subtotal() + fee)}</span></div>`;
    updateFooter();
  }
  form.addEventListener('change', (e) => {
    if (e.target.name === 'type' || e.target.name === 'pay') syncCheckout();
    if (e.target.name === 'pay' && touched.has('email')) showFieldState('email');
  });

  // Validação: só depois de sair do campo; o erro some ao voltar a ele.
  const isDelivery = () => form.querySelector('input[name=type]:checked')?.value === 'delivery';
  const isOnline = () => ['pix', 'card'].includes(form.querySelector('input[name=pay]:checked')?.value);
  const RULES = {
    name: () => (form.name.value.trim().length < 2 ? 'Digite seu nome.' : ''),
    phone: () => {
      const d = form.phone.value.replace(/\D/g, '');
      return d.length < 10 || d.length > 11 ? 'Digite o WhatsApp com DDD, como (63) 99999-9999.' : '';
    },
    email: () => {
      const v = form.email.value.trim();
      if (!v) return isOnline() ? 'Digite seu e-mail. O pagamento online envia o comprovante para ele.' : '';
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? '' : 'Digite um e-mail como nome@exemplo.com.';
    },
    cep: () => {
      if (!isDelivery()) return '';
      const d = form.cep.value.replace(/\D/g, '');
      if (d.length !== 8) return 'Digite os 8 números do CEP.';
      if (!address || address.cep !== d) return 'Toque em Buscar para confirmar o CEP.';
      return '';
    },
    street: () => (isDelivery() && !form.street.value.trim() ? 'Digite o nome da rua.' : ''),
    number: () => (isDelivery() && !form.number.value.trim() ? 'Digite o número. Se não tiver, escreva S/N.' : ''),
    neighborhood: () => (isDelivery() && !form.neighborhood.value.trim() ? 'Digite o bairro.' : ''),
    cityUf: () => (isDelivery() && address?.manual && !form.cityUf.value.trim() ? 'Digite a cidade, como Palmas / TO.' : ''),
  };
  const CEP_HELP = $('#msg-cep').innerHTML;

  function showFieldState(name, message = RULES[name]()) {
    const input = form.elements[name];
    const slot = document.getElementById(`msg-${name}`);
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (!slot) return message;
    slot.className = message ? 'msg error' : 'msg';
    if (message) slot.textContent = message;
    else if (name === 'cep') { if (slot.classList.contains('error') || !slot.textContent) slot.innerHTML = CEP_HELP; } else slot.textContent = '';
    return message;
  }
  function clearFieldState(name) {
    const input = form.elements[name];
    if (input.getAttribute('aria-invalid') !== 'true') return;
    input.removeAttribute('aria-invalid');
    const slot = document.getElementById(`msg-${name}`);
    if (slot) { slot.className = 'msg'; if (name === 'cep') slot.innerHTML = CEP_HELP; else slot.textContent = ''; }
  }

  Object.keys(RULES).forEach((name) => {
    const input = form.elements[name];
    input.addEventListener('blur', () => {
      if (name === 'cep' && form.cep.value.replace(/\D/g, '').length === 8 && address?.cep !== form.cep.value.replace(/\D/g, '')) return; // busca em andamento
      touched.add(name);
      showFieldState(name);
    });
    input.addEventListener('focus', () => { if (!focusingFromSubmit) clearFieldState(name); });
    input.addEventListener('input', () => clearFieldState(name));
  });

  // CEP
  const formatCep = (v) => String(v || '').replace(/\D/g, '').slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');
  form.cep.addEventListener('input', () => {
    form.cep.value = formatCep(form.cep.value);
    if (form.cep.value.length === 9) lookupCep();
  });
  form.cep.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lookupCep(); } });
  $('#cepBtn').addEventListener('click', lookupCep);

  // ViaCEP primeiro; se estiver fora do ar, BrasilAPI. Retorna null se o CEP não existe.
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
    const slot = $('#msg-cep');
    if (cep.length !== 8) { touched.add('cep'); showFieldState('cep'); return; }
    slot.className = 'msg';
    slot.textContent = 'Buscando endereço…';
    form.cityUf.readOnly = true;
    const seq = ++cepSeq;
    let data;
    try {
      data = await fetchCep(cep);
    } catch {
      if (seq !== cepSeq) return;
      address = { cep, city: '', state: '', manual: true };
      form.cityUf.readOnly = false;
      form.cityUf.tabIndex = 0;
      form.cityUf.placeholder = 'Ex.: Palmas / TO';
      slot.className = 'msg';
      slot.textContent = 'Não conseguimos consultar o CEP agora. Preencha o endereço abaixo.';
      form.street.focus();
      return;
    }
    if (seq !== cepSeq) return;
    if (!data) {
      address = null;
      form.cep.setAttribute('aria-invalid', 'true');
      slot.className = 'msg error';
      slot.textContent = 'Esse CEP não existe. Confira os números.';
      return;
    }
    address = { cep, ...data };
    form.cep.setAttribute('aria-invalid', 'false');
    if (data.street) form.street.value = data.street;
    if (data.neighborhood) form.neighborhood.value = data.neighborhood;
    form.cityUf.value = `${data.city} / ${data.state}`;
    ['street', 'neighborhood'].forEach((n) => form.elements[n].value && clearFieldState(n));
    const cities = MENU.settings.deliveryCities.split(',').map(norm).filter(Boolean);
    if (cities.length && !cities.includes(norm(data.city))) {
      slot.className = 'msg error';
      slot.textContent = `Ainda não entregamos em ${data.city}. Escolha retirar no balcão.`;
    } else {
      slot.className = 'msg ok';
      slot.textContent = `Entregamos em ${data.city}. Falta só o número.`;
      (data.street ? form.number : form.street).focus();
    }
  }

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
    $('#bagDialog .modal-body').scrollTop = 0;
  }

  let submitting = false;
  async function submitOrder() {
    if (submitting) return;
    $('#checkoutError').classList.add('hidden');
    const pay = form.querySelector('input[name=pay]:checked')?.value;
    if (!pay) { showError('Escolha como vai pagar.'); return; }

    // Valida tudo e leva ao primeiro campo com problema
    const order = ['cep', 'street', 'number', 'neighborhood', 'cityUf', 'name', 'phone', 'email'];
    const firstBad = order.find((n) => { touched.add(n); return showFieldState(n); });
    if (firstBad) {
      const el = form.elements[firstBad];
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      focusingFromSubmit = true;
      el.focus({ preventScroll: true });
      focusingFromSubmit = false;
      return;
    }

    const type = form.querySelector('input[name=type]:checked').value;
    if (type === 'delivery' && address.manual) {
      const [city, uf = ''] = form.cityUf.value.split(/[/-]/).map((x) => x.trim());
      Object.assign(address, { city, state: uf.slice(0, 2).toUpperCase() });
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
    const btn = $('#bagNext');
    btn.setAttribute('aria-busy', 'true');
    updateFooter();
    try {
      const r = await api('/api/orders', { method: 'POST', body });
      store.set(CUSTOMER_KEY, { name: body.customer.name, phone: body.customer.phone, email: body.customer.email, address: body.address || store.get(CUSTOMER_KEY, {})?.address });
      store.set('papitos_orders', [{ id: r.id, token: r.token, at: Date.now() }, ...store.get('papitos_orders', [])].slice(0, 10));
      cart = [];
      saveCart();
      location.href = `/pedido?id=${r.id}&t=${encodeURIComponent(r.token)}`;
    } catch (e) {
      showError(e.message);
    } finally {
      submitting = false;
      btn.removeAttribute('aria-busy');
      updateFooter();
    }
  }

  saveCart();
  load();
})();
