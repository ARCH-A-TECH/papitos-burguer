/* Painel do dono */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const A = '/api/admin';

  const centsToInput = (c) => (c / 100).toFixed(2).replace('.', ',');
  const fmtTime = (iso) => new Date(`${iso.replace(' ', 'T')}Z`).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  let state = { categories: [], products: [], addons: [], settings: null, orders: [] };

  async function call(path, opts) {
    try { return await api(A + path, opts); } catch (e) {
      if (e.status === 401 && path !== '/login') showLogin();
      throw e;
    }
  }

  // ---------- Login ----------
  function showLogin() {
    clearInterval(ordersTimer);
    $('#appView').classList.add('hidden');
    $('#loginView').classList.remove('hidden');
  }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    $('#loginError').classList.add('hidden');
    try {
      await call('/login', { method: 'POST', body: { username: f.username.value, password: f.password.value } });
      f.password.value = '';
      start();
    } catch (err) {
      $('#loginError').textContent = err.message;
      $('#loginError').classList.remove('hidden');
    }
  });
  $('#logoutBtn').addEventListener('click', async () => { await call('/logout', { method: 'POST' }).catch(() => {}); showLogin(); });

  // ---------- Abas ----------
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    $$('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
    $$('[data-view]').forEach((v) => v.classList.toggle('hidden', v.dataset.view !== b.dataset.tab));
    if (b.dataset.tab === 'orders') { seenMax = maxOrderId(); updateBadge(); }
  });

  async function start() {
    $('#loginView').classList.add('hidden');
    $('#appView').classList.remove('hidden');
    await Promise.all([loadCatalog(), loadSettings(), loadOrders(true)]);
    clearInterval(ordersTimer);
    ordersTimer = setInterval(() => loadOrders(false), 10000);
  }

  // ---------- Pedidos ----------
  let ordersTimer = null;
  let seenMax = 0;
  let soundOn = true;
  const maxOrderId = () => state.orders.filter((o) => o.status !== 'aguardando_pagamento').reduce((m, o) => Math.max(m, o.id), 0);

  function beep() {
    if (!soundOn) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.25, 0.5].forEach((t) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 880;
        o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.2, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
        o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
      });
    } catch { /* sem áudio */ }
  }
  $('#soundBtn').addEventListener('click', () => { soundOn = !soundOn; $('#soundBtn').textContent = soundOn ? 'Som ligado' : 'Som desligado'; });

  function updateBadge() {
    const n = state.orders.filter((o) => o.id > seenMax && o.status !== 'aguardando_pagamento').length;
    $('#newBadge').textContent = n;
    $('#newBadge').classList.toggle('hidden', !n);
    document.title = n ? `(${n}) Novo pedido! — Painel` : 'Painel — Papito\'s Burguer';
  }

  async function loadOrders(first) {
    let list;
    try { list = await call('/orders?days=2'); } catch { return; }
    const prevMax = maxOrderId();
    state.orders = list;
    if (first) seenMax = maxOrderId();
    else if (maxOrderId() > prevMax) { beep(); toast('Chegou um pedido novo'); }
    updateBadge();
    renderOrders();
  }

  const payPill = (o) => {
    const cls = { aprovado: 'ok', pendente: 'warn', recusado: 'bad', cancelado: 'bad', estornado: 'bad', na_entrega: '' }[o.paymentStatus];
    return `<span class="status-text ${cls}">${PAYMENT_STATUS_LABELS[o.paymentStatus]}</span>`;
  };

  function renderOrders() {
    const filter = $('#orderFilter').value;
    const today = new Date().toDateString();
    const todays = state.orders.filter((o) => new Date(`${o.createdAt.replace(' ', 'T')}Z`).toDateString() === today && o.status !== 'cancelado' && o.status !== 'aguardando_pagamento');
    $('#ordersSummary').innerHTML = `
      <div class="stat"><b>${todays.length}</b><span>pedidos hoje</span></div>
      <div class="stat"><b>${money(todays.reduce((s, o) => s + o.totalCents, 0))}</b><span>faturado hoje</span></div>
      <div class="stat"><b>${state.orders.filter((o) => ['recebido', 'em_preparo'].includes(o.status)).length}</b><span>na cozinha</span></div>`;

    const list = state.orders.filter((o) => {
      if (filter === 'all') return true;
      if (filter === 'active') return ['recebido', 'em_preparo', 'saiu_entrega', 'pronto_retirada'].includes(o.status);
      return o.status === filter;
    });
    if (!list.length) {
      $('#ordersList').innerHTML = '<p class="empty" style="grid-column:1/-1"><b>Nenhum pedido nesta lista.</b>Pedidos novos aparecem aqui sozinhos, com aviso sonoro.</p>';
      return;
    }
    $('#ordersList').innerHTML = list.map((o) => {
      const statuses = o.type === 'delivery'
        ? ['aguardando_pagamento', 'recebido', 'em_preparo', 'saiu_entrega', 'concluido', 'cancelado']
        : ['aguardando_pagamento', 'recebido', 'em_preparo', 'pronto_retirada', 'concluido', 'cancelado'];
      const a = o.address;
      const wa = `https://wa.me/55${o.customer.phone.replace(/^55/, '')}`;
      return `
      <article class="order-card ${o.id > seenMax && o.status !== 'aguardando_pagamento' ? 'is-new' : ''}" data-id="${o.id}">
        <header><b>Nº ${o.id}, ${esc(o.customer.name)}</b><span class="meta">${fmtTime(o.createdAt)}</span></header>
        <div class="row">
          <span class="kind">${o.type === 'delivery' ? 'Entrega' : 'Retirada'}</span>
          ${payPill(o)}
          <span class="meta">${PAY_LABELS[o.paymentMethod]}</span>
        </div>
        <ul>${o.items.map((i) => `<li><b>${i.qty}× ${esc(i.name)}</b>
          ${i.addons.length ? `<small>+ ${esc(i.addons.map((x) => x.name).join(', '))}</small>` : ''}
          ${i.notes ? `<small>Obs.: ${esc(i.notes)}</small>` : ''}</li>`).join('')}</ul>
        ${o.notes ? `<div class="meta"><b>Obs. do pedido:</b> ${esc(o.notes)}</div>` : ''}
        ${a ? `<div class="meta"><b>Endereço:</b> ${esc(`${a.street}, ${a.number}${a.complement ? ` - ${a.complement}` : ''} - ${a.neighborhood}, ${a.city}/${a.state}, CEP ${a.cep}`)}${a.reference ? `<br>Ref.: ${esc(a.reference)}` : ''}</div>` : ''}
        <div class="meta"><b>WhatsApp:</b> <a href="${wa}" target="_blank" rel="noopener">${esc(formatPhone(o.customer.phone))}</a>
          ${o.changeForCents ? `<br><b>Troco:</b> para ${money(o.changeForCents)}, levar ${money(o.changeForCents - o.totalCents)}` : ''}</div>
        <div class="row" style="justify-content:space-between">
          <b class="price">${money(o.totalCents)}</b>
          <select data-status aria-label="Status do pedido">${statuses.map((s) => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}</select>
        </div>
      </article>`;
    }).join('');
  }
  $('#orderFilter').addEventListener('change', renderOrders);
  $('#ordersList').addEventListener('click', (e) => {
    if (e.target.closest('.order-card')) { seenMax = Math.max(seenMax, maxOrderId()); updateBadge(); }
  });
  $('#ordersList').addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-status]');
    if (!sel) return;
    const id = Number(sel.closest('[data-id]').dataset.id);
    if (sel.value === 'cancelado' && !confirm(`Cancelar o pedido #${id}?${state.orders.find((o) => o.id === id)?.paymentStatus === 'aprovado' ? '\n\nATENÇÃO: este pedido já foi pago online. Faça o estorno pelo painel do Mercado Pago.' : ''}`)) {
      renderOrders();
      return;
    }
    try {
      const updated = await call(`/orders/${id}/status`, { method: 'PUT', body: { status: sel.value } });
      state.orders = state.orders.map((o) => (o.id === id ? updated : o));
      toast(`Pedido #${id}: ${STATUS_LABELS[updated.status]}`);
      renderOrders();
    } catch (err) { toast(err.message); }
  });

  // ---------- Catálogo ----------
  async function loadCatalog() {
    const [categories, products, addons] = await Promise.all([call('/categories'), call('/products'), call('/addons')]);
    Object.assign(state, { categories, products, addons });
    renderProducts();
    renderAddons();
    renderCategories();
  }

  const thumb = (img, cls = 'thumb') => (img ? `<img class="${cls}" src="${esc(img)}" alt="">` : `<div class="${cls} placeholder">${BURGER_SVG}</div>`);
  const sw = (checked, attrs) => `<label class="switch"><input type="checkbox" ${checked ? 'checked' : ''} ${attrs}><span></span></label>`;

  function renderProducts() {
    const term = $('#productSearch').value.trim().toLowerCase();
    const groups = [...state.categories, { id: null, name: 'Sem categoria' }];
    const rows = groups.map((c) => {
      const ps = state.products.filter((p) => p.category_id === c.id && (!term || p.name.toLowerCase().includes(term)));
      if (!ps.length) return '';
      return `<tr class="cat-head"><td colspan="5">${esc(c.name)}</td></tr>` + ps.map((p) => `
        <tr class="${p.active ? '' : 'off'}" data-id="${p.id}">
          <td class="col-thumb">${thumb(p.image)}</td>
          <td><b>${esc(p.name)}</b>${p.featured ? ' <span class="muted">(destaque)</span>' : ''}<div class="muted hide-sm desc">${esc(p.description)}</div></td>
          <td class="nowrap">R$ <input class="price-input" type="text" inputmode="decimal" value="${centsToInput(p.price_cents)}" data-price aria-label="Preço de ${esc(p.name)}"></td>
          <td title="Disponível">${sw(p.active, 'data-active')}</td>
          <td style="text-align:right"><button class="btn small ghost" data-edit>Editar</button></td>
        </tr>`).join('');
    }).join('');
    $('#productsList').innerHTML = rows
      ? `<table class="table"><thead><tr><th class="col-thumb"><span class="sr-only">Foto</span></th><th>Produto</th><th>Preço</th><th>Ativo</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="empty">Nenhum produto encontrado.</p>';
  }
  $('#productSearch').addEventListener('input', renderProducts);

  $('#productsList').addEventListener('change', async (e) => {
    const tr = e.target.closest('[data-id]');
    if (!tr) return;
    const id = Number(tr.dataset.id);
    const body = e.target.matches('[data-price]') ? { price: e.target.value } : e.target.matches('[data-active]') ? { active: e.target.checked } : null;
    if (!body) return;
    try {
      const p = await call(`/products/${id}`, { method: 'PATCH', body });
      state.products = state.products.map((x) => (x.id === id ? p : x));
      toast(body.price !== undefined ? `Preço atualizado: ${money(p.price_cents)}` : p.active ? 'Produto disponível' : 'Produto pausado');
      renderProducts();
    } catch (err) { toast(err.message); renderProducts(); }
  });
  $('#productsList').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-price]')) e.target.blur(); });
  $('#productsList').addEventListener('click', (e) => {
    if (e.target.closest('[data-edit]')) openProductEditor(state.products.find((p) => p.id === Number(e.target.closest('[data-id]').dataset.id)));
  });
  $('#newProduct').addEventListener('click', () => openProductEditor(null));

  // Editor de produto
  const pe = $('#productEditorForm');
  let editing = null;
  let pendingFile = null;

  function openProductEditor(p) {
    editing = p;
    pendingFile = null;
    $('#peError').classList.add('hidden');
    $('#peTitle').textContent = p ? 'Editar produto' : 'Novo produto';
    pe.category_id.innerHTML = state.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('') + '<option value="">Sem categoria</option>';
    pe.name.value = p?.name || '';
    pe.description.value = p?.description || '';
    pe.price.value = p ? centsToInput(p.price_cents) : '';
    pe.category_id.value = p ? (p.category_id ?? '') : (state.categories[0]?.id ?? '');
    pe.sort.value = p?.sort ?? 0;
    pe.active.checked = p ? !!p.active : true;
    pe.featured.checked = !!p?.featured;
    pe.accepts_addons.checked = p ? !!p.accepts_addons : true;
    $('#peImage').outerHTML = thumb(p?.image).replace('class="thumb', 'id="peImage" class="thumb');
    $('#peRemoveImg').classList.toggle('hidden', !p?.image);
    $('#peDelete').classList.toggle('hidden', !p);
    $('#productEditor').showModal();
  }

  $('#peFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast('Imagem muito grande (máx. 5 MB).'); e.target.value = ''; return; }
    pendingFile = f;
    $('#peImage').outerHTML = `<img id="peImage" class="thumb" src="${URL.createObjectURL(f)}" alt="">`;
  });
  $('#peRemoveImg').addEventListener('click', async () => {
    if (!editing || !confirm('Remover a foto deste produto?')) return;
    await call(`/products/${editing.id}/image`, { method: 'DELETE' });
    await loadCatalog();
    openProductEditor(state.products.find((p) => p.id === editing.id));
  });

  pe.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      name: pe.name.value, description: pe.description.value, price: pe.price.value, category_id: pe.category_id.value,
      sort: pe.sort.value, active: pe.active.checked, featured: pe.featured.checked, accepts_addons: pe.accepts_addons.checked,
    };
    const btn = pe.querySelector('button:not([type])');
    btn.disabled = true;
    try {
      const p = editing ? await call(`/products/${editing.id}`, { method: 'PUT', body }) : await call('/products', { method: 'POST', body });
      if (pendingFile) {
        const fd = new FormData();
        fd.append('image', pendingFile);
        const r = await fetch(`${A}/products/${p.id}/image`, { method: 'POST', body: fd, credentials: 'same-origin' });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha ao enviar a foto.');
      }
      await loadCatalog();
      $('#productEditor').close();
      toast('Produto salvo');
    } catch (err) {
      $('#peError').textContent = err.message;
      $('#peError').classList.remove('hidden');
    } finally { btn.disabled = false; }
  });
  $('#peDelete').addEventListener('click', async () => {
    if (!editing || !confirm(`Excluir "${editing.name}" definitivamente?\nDica: para tirar do cardápio só por um tempo, desmarque "Disponível".`)) return;
    await call(`/products/${editing.id}`, { method: 'DELETE' });
    await loadCatalog();
    $('#productEditor').close();
    toast('Produto excluído.');
  });

  // ---------- Adicionais e categorias ----------
  function renderAddons() {
    $('#addonsList').innerHTML = `<table class="table"><thead><tr><th>Adicional</th><th>Preço</th><th>Ativo</th><th></th></tr></thead><tbody>
      ${state.addons.map((a) => `<tr class="${a.active ? '' : 'off'}" data-id="${a.id}"><td><b>${esc(a.name)}</b></td><td>${money(a.price_cents)}</td>
        <td>${a.active ? '<span class="status-text ok">Sim</span>' : '<span class="status-text">Não</span>'}</td>
        <td style="text-align:right"><button class="btn small ghost" data-edit>Editar</button></td></tr>`).join('')}
      </tbody></table>`;
  }
  function renderCategories() {
    $('#categoriesList').innerHTML = `<table class="table"><thead><tr><th>Categoria</th><th>Produtos</th><th>Ordem</th><th>Ativa</th><th></th></tr></thead><tbody>
      ${state.categories.map((c) => `<tr class="${c.active ? '' : 'off'}" data-id="${c.id}"><td><b>${esc(c.name)}</b></td>
        <td>${state.products.filter((p) => p.category_id === c.id).length}</td><td>${c.sort}</td>
        <td>${c.active ? '<span class="status-text ok">Sim</span>' : '<span class="status-text">Não</span>'}</td>
        <td style="text-align:right"><button class="btn small ghost" data-edit>Editar</button></td></tr>`).join('')}
      </tbody></table>`;
  }

  const se = $('#simpleEditorForm');
  let seCtx = null;
  function openSimple(kind, item) {
    seCtx = { kind, item };
    $('#seError').classList.add('hidden');
    $('#seTitle').textContent = `${item ? 'Editar' : 'Novo'} ${kind === 'addons' ? 'adicional' : 'categoria'}`;
    $('#sePriceField').classList.toggle('hidden', kind !== 'addons');
    se.name.value = item?.name || '';
    se.price.value = item ? centsToInput(item.price_cents || 0) : '';
    se.sort.value = item?.sort ?? (kind === 'addons' ? state.addons.length + 1 : state.categories.length + 1);
    se.active.checked = item ? !!item.active : true;
    $('#seDelete').classList.toggle('hidden', !item);
    $('#simpleEditor').showModal();
  }
  $('#newAddon').addEventListener('click', () => openSimple('addons', null));
  $('#newCategory').addEventListener('click', () => openSimple('categories', null));
  $('#addonsList').addEventListener('click', (e) => { if (e.target.closest('[data-edit]')) openSimple('addons', state.addons.find((a) => a.id === Number(e.target.closest('[data-id]').dataset.id))); });
  $('#categoriesList').addEventListener('click', (e) => { if (e.target.closest('[data-edit]')) openSimple('categories', state.categories.find((c) => c.id === Number(e.target.closest('[data-id]').dataset.id))); });

  se.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { kind, item } = seCtx;
    const body = { name: se.name.value, price: se.price.value, sort: se.sort.value, active: se.active.checked };
    try {
      await call(item ? `/${kind}/${item.id}` : `/${kind}`, { method: item ? 'PUT' : 'POST', body });
      await loadCatalog();
      $('#simpleEditor').close();
      toast('Alterações salvas');
    } catch (err) { $('#seError').textContent = err.message; $('#seError').classList.remove('hidden'); }
  });
  $('#seDelete').addEventListener('click', async () => {
    const { kind, item } = seCtx;
    if (!confirm(`Excluir "${item.name}"?`)) return;
    try {
      await call(`/${kind}/${item.id}`, { method: 'DELETE' });
      await loadCatalog();
      $('#simpleEditor').close();
      toast('Excluído.');
    } catch (err) { $('#seError').textContent = err.message; $('#seError').classList.remove('hidden'); }
  });

  $$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

  // ---------- Configurações ----------
  const sf = $('#settingsForm');
  async function loadSettings() {
    const [s, menu] = await Promise.all([call('/settings'), api('/api/menu')]);
    state.settings = s;
    for (const [k, v] of Object.entries(s)) {
      const el = sf.elements[k];
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    }
    sf.deliveryFee.value = centsToInput(s.deliveryFeeCents);
    sf.minOrder.value = centsToInput(s.minOrderCents);
    syncOpenToggle();
    $('#paymentProviderInfo').innerHTML = menu.payment.live
      ? '<b>Mercado Pago ligado.</b> Pix e cartão são cobrados de verdade.'
      : '<b>Modo de teste.</b> Para receber pagamentos de verdade, coloque as chaves do Mercado Pago (MP_ACCESS_TOKEN e MP_PUBLIC_KEY) no servidor.';
  }
  const parseMoney = (v) => Math.round(Number(String(v || '0').replace(/\./g, '').replace(',', '.')) * 100) || 0;

  sf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {};
    for (const k of Object.keys(state.settings)) {
      const el = sf.elements[k];
      if (el) body[k] = el.type === 'checkbox' ? el.checked : el.value;
    }
    body.deliveryFeeCents = parseMoney(sf.deliveryFee.value);
    body.minOrderCents = parseMoney(sf.minOrder.value);
    body.whatsapp = String(body.whatsapp).replace(/\D/g, '');
    body.instagram = String(body.instagram).replace(/^@/, '');
    if (body.whatsapp && body.whatsapp.length <= 11) body.whatsapp = `55${body.whatsapp}`;
    try {
      state.settings = await call('/settings', { method: 'PUT', body });
      await loadSettings();
      toast('Configurações salvas');
    } catch (err) { toast(err.message); }
  });

  function syncOpenToggle() {
    $('#openToggle').checked = !!state.settings.isOpen;
    $('#openLabel').textContent = state.settings.isOpen ? 'Loja aberta' : 'Loja fechada';
  }
  $('#openToggle').addEventListener('change', async (e) => {
    try {
      state.settings = await call('/settings', { method: 'PUT', body: { isOpen: e.target.checked } });
      sf.isOpen.checked = state.settings.isOpen;
      syncOpenToggle();
      toast(state.settings.isOpen ? 'Loja ABERTA para pedidos' : 'Loja FECHADA para pedidos');
    } catch (err) { toast(err.message); e.target.checked = !e.target.checked; }
  });

  $('#pwBtn').addEventListener('click', async () => {
    try {
      await call('/password', { method: 'POST', body: { current: $('#pwCurrent').value, next: $('#pwNext').value } });
      $('#pwCurrent').value = ''; $('#pwNext').value = '';
      toast('Senha alterada');
    } catch (err) { toast(err.message); }
  });

  // ---------- Início ----------
  call('/me').then(start).catch(showLogin);
})();
