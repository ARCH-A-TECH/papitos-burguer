// Confere o site no navegador: screenshots em 375px (celular) e 1280px (computador)
// e verifica se alguma página rola para o lado.
// Uso: node scripts/screens.js <baseUrl> <pastaSaida> <senhaAdmin>
const { chromium } = require('playwright');

(async () => {
  const [base = 'http://localhost:3000', out = '.', pass = ''] = process.argv.slice(2);
  const browser = await chromium.launch();
  const problems = [];

  async function checkOverflow(page, label) {
    const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    if (r.sw > r.cw) problems.push(`${label}: rolagem lateral (${r.sw} > ${r.cw})`);
  }
  async function newPage(viewport, scale) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, isMobile: viewport.width < 768, hasTouch: viewport.width < 768 });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => problems.push(`erro JS: ${e.message}`));
    // A rede deste ambiente de teste não acessa APIs externas: simula o ViaCEP e ignora fontes
    await p.route('https://viacep.com.br/**', (r) => r.fulfill({ json: { cep: '77001-002', logradouro: 'Quadra 104 Norte, Avenida LO 2', bairro: 'Plano Diretor Norte', localidade: 'Palmas', uf: 'TO' } }));
    await p.route('https://fonts.googleapis.com/**', (r) => r.abort());
    return p;
  }

  // ----- celular -----
  const m = await newPage({ width: 375, height: 812 }, 2);
  await m.goto(base, { waitUntil: 'networkidle' });
  await checkOverflow(m, 'home 375');
  await m.screenshot({ path: `${out}/m1-inicio.png` });
  await m.evaluate(() => document.querySelector('#cardapio').scrollIntoView());
  await m.waitForTimeout(300);
  await m.screenshot({ path: `${out}/m2-cardapio.png` });
  await m.click('#heroFeatured');
  await m.check('#productBody input[name=addon] >> nth=0');
  await m.waitForTimeout(300);
  await m.screenshot({ path: `${out}/m3-lanche.png` });
  await m.click('#pdAdd');
  await m.locator('[data-product]').nth(3).click();
  await m.click('#pdAdd');
  await m.waitForTimeout(300);
  await checkOverflow(m, 'home 375 com sacola');
  await m.screenshot({ path: `${out}/m4-barra-sacola.png` });
  await m.click('#bagBar');
  await m.waitForTimeout(300);
  await m.screenshot({ path: `${out}/m5-sacola.png` });
  await m.click('#bagNext');
  // envia vazio para ver os erros por campo
  await m.click('#bagNext');
  await m.waitForTimeout(400);
  await m.screenshot({ path: `${out}/m6-erros.png` });
  await m.fill('input[name=cep]', '77001-002');
  await m.waitForTimeout(600);
  await m.fill('input[name=number]', '123');
  await m.fill('input[name=name]', 'Maria Cliente');
  await m.fill('input[name=phone]', '63999998888');
  await m.fill('input[name=email]', 'maria@example.com');
  await m.screenshot({ path: `${out}/m7-checkout.png` });
  await m.click('#bagNext');
  await m.waitForURL(/pedido/, { timeout: 5000 }).catch(() => problems.push('não foi para a página do pedido'));
  await m.waitForTimeout(1200);
  await checkOverflow(m, 'pedido 375');
  await m.screenshot({ path: `${out}/m8-pedido-pix.png`, fullPage: true });
  if (m.url().includes('pedido')) {
    await m.click('#demoPay');
    await m.waitForTimeout(800);
    await m.screenshot({ path: `${out}/m9-pedido-pago.png` });
  }
  await m.goto(`${base}/admin`, { waitUntil: 'networkidle' });
  await m.fill('input[name=username]', 'admin');
  await m.fill('input[name=password]', pass);
  await m.click('#loginForm button');
  await m.waitForTimeout(1000);
  await checkOverflow(m, 'admin pedidos 375');
  await m.screenshot({ path: `${out}/m10-admin-pedidos.png` });
  for (const tab of ['products', 'addons', 'categories', 'settings']) {
    await m.click(`[data-tab=${tab}]`);
    await m.waitForTimeout(200);
    await checkOverflow(m, `admin ${tab} 375`);
  }
  await m.click('[data-tab=products]');
  await m.waitForTimeout(200);
  await m.screenshot({ path: `${out}/m11-admin-produtos.png` });

  // ----- computador -----
  const d = await newPage({ width: 1280, height: 820 }, 1);
  await d.goto(base, { waitUntil: 'networkidle' });
  await checkOverflow(d, 'home 1280');
  await d.screenshot({ path: `${out}/d1-inicio.png` });
  await d.locator('[data-product]').nth(0).click();
  await d.click('#pdAdd');
  await d.evaluate(() => window.scrollTo(0, 620));
  await d.waitForTimeout(300);
  await d.screenshot({ path: `${out}/d2-cardapio-comanda.png` });
  await d.goto(`${base}/admin`, { waitUntil: 'networkidle' });
  await d.fill('input[name=username]', 'admin');
  await d.fill('input[name=password]', pass);
  await d.click('#loginForm button');
  await d.waitForTimeout(1000);
  await checkOverflow(d, 'admin 1280');
  await d.screenshot({ path: `${out}/d3-admin.png` });

  console.log(problems.length ? problems.join('\n') : 'OK: sem rolagem lateral e sem erros de JS');
  await browser.close();
})();
